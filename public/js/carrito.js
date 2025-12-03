require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
  host: process.env.MYSQLHOST || 'trolley.proxy.rlwy.net',
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || 'BfFJKTbqGzcoAznyJPvnRgqpArfBWBZj',
  database: process.env.MYSQLDATABASE || 'railway',
  port: parseInt(process.env.MYSQLPORT) || 28060
};

const pool = mysql.createPool(dbConfig);
const sessionStore = new MySQLStore(dbConfig);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  key: 'session_cookie',
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  res.locals.carrito = req.session.carrito || [];
  next();
});

app.get('/', async (req, res) => {
  try {
    const [productos] = await pool.query('SELECT * FROM productos ORDER BY id');
    res.render('index', { productos });
  } catch (error) {
    console.error('Error al cargar productos:', error);
    res.status(500).send('Error al cargar los productos');
  }
});

app.get('/registro', (req, res) => {
  res.render('registro');
});

app.post('/registro', async (req, res) => {
  const { nombre, email, password } = req.body;
  try {
    const [usuarios] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);
    if (usuarios.length > 0) {
      return res.render('registro', { error: 'El email ya está registrado' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)', [nombre, email, hashedPassword]);
    res.redirect('/login?registro=exitoso');
  } catch (error) {
    console.error('Error en el registro:', error);
    res.render('registro', { error: 'Error al registrar usuario' });
  }
});

app.get('/login', (req, res) => {
  const mensaje = req.query.registro === 'exitoso' ? 'Registro exitoso. Inicia sesión.' : null;
  res.render('login', { mensaje });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [usuarios] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);
    if (usuarios.length === 0) {
      return res.render('login', { error: 'Usuario no encontrado' });
    }
    const usuario = usuarios[0];
    const passwordValida = await bcrypt.compare(password, usuario.password);
    if (!passwordValida) {
      return res.render('login', { error: 'Contraseña incorrecta' });
    }
    req.session.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email
    };
    res.redirect('/');
  } catch (error) {
    console.error('Error en el login:', error);
    res.render('login', { error: 'Error al iniciar sesión' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.post('/carrito/agregar', (req, res) => {
  const { producto_id } = req.body;
  if (!req.session.carrito) {
    req.session.carrito = [];
  }
  const index = req.session.carrito.findIndex(item => item.producto_id == producto_id);
  if (index !== -1) {
    req.session.carrito[index].cantidad++;
  } else {
    req.session.carrito.push({ producto_id: parseInt(producto_id), cantidad: 1 });
  }
  res.json({ success: true, carrito: req.session.carrito });
});

app.get('/carrito', async (req, res) => {
  try {
    if (!req.session.carrito || req.session.carrito.length === 0) {
      return res.render('carrito', { items: [], total: 0 });
    }
    const ids = req.session.carrito.map(item => item.producto_id);
    const [productos] = await pool.query('SELECT * FROM productos WHERE id IN (?)', [ids]);
    const items = req.session.carrito.map(item => {
      const producto = productos.find(p => p.id === item.producto_id);
      return { ...producto, cantidad: item.cantidad, subtotal: producto.precio * item.cantidad };
    });
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    res.render('carrito', { items, total });
  } catch (error) {
    console.error('Error al cargar el carrito:', error);
    res.status(500).send('Error al cargar el carrito');
  }
});

app.post('/carrito/actualizar', (req, res) => {
  const { producto_id, cantidad } = req.body;
  if (!req.session.carrito) {
    return res.json({ success: false });
  }
  const index = req.session.carrito.findIndex(item => item.producto_id == producto_id);
  if (index !== -1) {
    if (cantidad <= 0) {
      req.session.carrito.splice(index, 1);
    } else {
      req.session.carrito[index].cantidad = parseInt(cantidad);
    }
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post('/carrito/eliminar', (req, res) => {
  const { producto_id } = req.body;
  if (!req.session.carrito) {
    return res.json({ success: false });
  }
  req.session.carrito = req.session.carrito.filter(item => item.producto_id != producto_id);
  res.json({ success: true });
});

app.post('/carrito/comprar', async (req, res) => {
  if (!req.session.usuario) {
    return res.json({ success: false, error: 'Debes iniciar sesión para comprar' });
  }
  if (!req.session.carrito || req.session.carrito.length === 0) {
    return res.json({ success: false, error: 'El carrito está vacío' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ids = req.session.carrito.map(item => item.producto_id);
    const [productos] = await connection.query('SELECT * FROM productos WHERE id IN (?)', [ids]);
    let total = 0;
    const items = req.session.carrito.map(item => {
      const producto = productos.find(p => p.id === item.producto_id);
      total += producto.precio * item.cantidad;
      return { producto_id: item.producto_id, cantidad: item.cantidad, precio: producto.precio };
    });
    for (let item of items) {
      const producto = productos.find(p => p.id === item.producto_id);
      if (producto.stock < item.cantidad) {
        throw new Error(`Stock insuficiente para ${producto.nombre}`);
      }
    }
    const [result] = await connection.query('INSERT INTO pedidos (usuario_id, total) VALUES (?, ?)', [req.session.usuario.id, total]);
    const pedido_id = result.insertId;
    for (let item of items) {
      await connection.query('INSERT INTO detalles_pedido (pedido_id, producto_id, cantidad, precio) VALUES (?, ?, ?, ?)', [pedido_id, item.producto_id, item.cantidad, item.precio]);
      await connection.query('UPDATE productos SET stock = stock - ? WHERE id = ?', [item.cantidad, item.producto_id]);
    }
    await connection.commit();
    req.session.carrito = [];
    res.json({ success: true, pedido_id });
  } catch (error) {
    await connection.rollback();
    console.error('Error al realizar compra:', error);
    res.json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

app.get('/historial', async (req, res) => {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }
  try {
    const [pedidos] = await pool.query(`SELECT p.*, 
        (SELECT GROUP_CONCAT(CONCAT(pr.nombre, ' (x', dp.cantidad, ')') SEPARATOR ', ')
         FROM detalles_pedido dp
         JOIN productos pr ON dp.producto_id = pr.id
         WHERE dp.pedido_id = p.id) as productos
       FROM pedidos p
       WHERE p.usuario_id = ?
       ORDER BY p.fecha DESC`, [req.session.usuario.id]);
    res.render('historial', { pedidos });
  } catch (error) {
    console.error('Error al cargar historial:', error);
    res.status(500).send('Error al cargar el historial');
  }
});

app.get('/ticket/:pedido_id', async (req, res) => {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }
  const pedido_id = req.params.pedido_id;
  try {
    const [pedidos] = await pool.query('SELECT * FROM pedidos WHERE id = ? AND usuario_id = ?', [pedido_id, req.session.usuario.id]);
    if (pedidos.length === 0) {
      return res.status(404).send('Pedido no encontrado');
    }
    const pedido = pedidos[0];
    const [detalles] = await pool.query(`SELECT dp.*, p.nombre, p.descripcion
       FROM detalles_pedido dp
       JOIN productos p ON dp.producto_id = p.id
       WHERE dp.pedido_id = ?`, [pedido_id]);
    const doc = new PDFDocument({margin: 20, size: 'A5'});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=ticket-${pedido_id}.pdf`);
    doc.pipe(res);
    const formatCurrency = (v) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v);
    const startX = doc.page.margins.left;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.font('Helvetica-Bold').fontSize(22).text('TIENDA ANIME', { align: 'center' });
    doc.font('Helvetica').fontSize(12).text('Tu tienda de coleccionables favorita', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(startX, doc.y).lineTo(startX + pageWidth, doc.y).stroke();
    doc.moveDown(0.8);
    const metaY = doc.y;
    doc.font('Helvetica-Bold').fontSize(11).text(`Pedido #${pedido.id}`);
    doc.font('Helvetica').fontSize(10).text(`Fecha: ${new Date(pedido.fecha).toLocaleString('es-MX')}`);
    doc.font('Helvetica').fontSize(10).text(`Cliente: ${req.session.usuario.nombre}`);
    doc.font('Helvetica').fontSize(10).text(`Email: ${req.session.usuario.email}`);
    doc.moveDown(0.5);
    doc.moveTo(startX, doc.y).lineTo(startX + pageWidth, doc.y).stroke();
    doc.moveDown(0.6);
    const tableTop = doc.y;
    const colQty = startX + 0;
    const colItem = startX + 40;
    const colPrice = startX + pageWidth - 160;
    const colSubtotal = startX + pageWidth - 60;
    doc.font('Helvetica-Bold').fontSize(11).text('Cant', colQty, tableTop);
    doc.font('Helvetica-Bold').fontSize(11).text('Producto', colItem, tableTop);
    doc.font('Helvetica-Bold').fontSize(11).text('Precio', colPrice, tableTop, { width: 90, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(11).text('Importe', colSubtotal, tableTop, { width: 60, align: 'right' });
    doc.moveDown(0.6);
    let y = doc.y;
    detalles.forEach(detalle => {
      const precio = parseFloat(detalle.precio);
      const subtotal = detalle.cantidad * precio;
      doc.font('Helvetica').fontSize(10).text(String(detalle.cantidad), colQty, y);
      doc.font('Helvetica').fontSize(10).text(detalle.nombre, colItem, y, { width: colPrice - colItem - 10 });
      doc.font('Helvetica').fontSize(10).text(formatCurrency(precio), colPrice, y, { width: 90, align: 'right' });
      doc.font('Helvetica').fontSize(10).text(formatCurrency(subtotal), colSubtotal, y, { width: 60, align: 'right' });
      y += 18;
      if (y > doc.page.height - doc.page.margins.bottom - 80) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    });
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    y += 8;
    const total = parseFloat(pedido.total);
    doc.font('Helvetica-Bold').fontSize(14).text('TOTAL', colPrice, y, { width: colSubtotal - colPrice + 60, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(14).text(formatCurrency(total), colSubtotal, y, { width: 60, align: 'right' });
    doc.moveDown(2);
    doc.font('Helvetica').fontSize(10).text('¡Gracias por tu compra!', { align: 'center' });
    doc.font('Helvetica-Oblique').fontSize(9).text('Visítanos en nuestra tienda física o síguenos en redes para nuevas colecciones.', { align: 'center' });
    doc.end();
  } catch (error) {
    console.error('Error al generar ticket:', error);
    res.status(500).send('Error al generar el ticket');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
