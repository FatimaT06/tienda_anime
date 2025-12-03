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

// Configuración de la base de datos para Railway
const dbConfig = {
  host: process.env.MYSQLHOST || 'trolley.proxy.rlwy.net',
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || 'BfFJKTbqGzcoAznyJPvnRgqpArfBWBZj',
  database: process.env.MYSQLDATABASE || 'railway',
  port: parseInt(process.env.MYSQLPORT) || 28060
};

// Pool de conexiones
const pool = mysql.createPool(dbConfig);

// Store de sesiones en MySQL
const sessionStore = new MySQLStore(dbConfig);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configuración de sesiones
app.use(session({
  key: 'session_cookie',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 // 24 horas
  }
}));

// Middleware para hacer disponible el usuario en todas las vistas
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  res.locals.carrito = req.session.carrito || [];
  next();
});

// Ruta principal - Mostrar productos
app.get('/', async (req, res) => {
  try {
    const [productos] = await pool.query('SELECT * FROM productos ORDER BY id');
    res.render('index', { productos });
  } catch (error) {
    console.error('Error al cargar productos:', error);
    res.status(500).send('Error al cargar los productos');
  }
});

// Registro de usuarios
app.get('/registro', (req, res) => {
  res.render('registro');
});

app.post('/registro', async (req, res) => {
  const { nombre, email, password } = req.body;
  
  try {
    // Verificar si el email ya existe
    const [usuarios] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);
    
    if (usuarios.length > 0) {
      return res.render('registro', { error: 'El email ya está registrado' });
    }
    
    // Encriptar contraseña
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Insertar usuario
    await pool.query(
      'INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)',
      [nombre, email, hashedPassword]
    );
    
    res.redirect('/login?registro=exitoso');
  } catch (error) {
    console.error('Error en el registro:', error);
    res.render('registro', { error: 'Error al registrar usuario' });
  }
});

// Login
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
    
    // Guardar usuario en sesión
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

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Agregar al carrito
app.post('/carrito/agregar', (req, res) => {
  const { producto_id } = req.body;
  
  if (!req.session.carrito) {
    req.session.carrito = [];
  }
  
  // Buscar si el producto ya está en el carrito
  const index = req.session.carrito.findIndex(item => item.producto_id == producto_id);
  
  if (index !== -1) {
    req.session.carrito[index].cantidad++;
  } else {
    req.session.carrito.push({
      producto_id: parseInt(producto_id),
      cantidad: 1
    });
  }
  
  res.json({ success: true, carrito: req.session.carrito });
});

// Ver carrito
app.get('/carrito', async (req, res) => {
  try {
    if (!req.session.carrito || req.session.carrito.length === 0) {
      return res.render('carrito', { items: [], total: 0 });
    }
    
    const ids = req.session.carrito.map(item => item.producto_id);
    const [productos] = await pool.query(
      'SELECT * FROM productos WHERE id IN (?)',
      [ids]
    );
    
    const items = req.session.carrito.map(item => {
      const producto = productos.find(p => p.id === item.producto_id);
      return {
        ...producto,
        cantidad: item.cantidad,
        subtotal: producto.precio * item.cantidad
      };
    });
    
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    
    res.render('carrito', { items, total });
  } catch (error) {
    console.error('Error al cargar el carrito:', error);
    res.status(500).send('Error al cargar el carrito');
  }
});

// Actualizar cantidad en carrito
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

// Eliminar del carrito
app.post('/carrito/eliminar', (req, res) => {
  const { producto_id } = req.body;
  
  if (!req.session.carrito) {
    return res.json({ success: false });
  }
  
  req.session.carrito = req.session.carrito.filter(item => item.producto_id != producto_id);
  res.json({ success: true });
});

// Realizar compra
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
    
    // Obtener productos del carrito
    const ids = req.session.carrito.map(item => item.producto_id);
    const [productos] = await connection.query(
      'SELECT * FROM productos WHERE id IN (?)',
      [ids]
    );
    
    // Calcular total
    let total = 0;
    const items = req.session.carrito.map(item => {
      const producto = productos.find(p => p.id === item.producto_id);
      total += producto.precio * item.cantidad;
      return {
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio: producto.precio
      };
    });
    
    // Verificar stock
    for (let item of items) {
      const producto = productos.find(p => p.id === item.producto_id);
      if (producto.stock < item.cantidad) {
        throw new Error(`Stock insuficiente para ${producto.nombre}`);
      }
    }
    
    // Crear pedido
    const [result] = await connection.query(
      'INSERT INTO pedidos (usuario_id, total) VALUES (?, ?)',
      [req.session.usuario.id, total]
    );
    
    const pedido_id = result.insertId;
    
    // Insertar detalles del pedido
    for (let item of items) {
      await connection.query(
        'INSERT INTO detalles_pedido (pedido_id, producto_id, cantidad, precio) VALUES (?, ?, ?, ?)',
        [pedido_id, item.producto_id, item.cantidad, item.precio]
      );
      
      // Actualizar stock
      await connection.query(
        'UPDATE productos SET stock = stock - ? WHERE id = ?',
        [item.cantidad, item.producto_id]
      );
    }
    
    await connection.commit();
    
    // Limpiar carrito
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

// Historial de compras
app.get('/historial', async (req, res) => {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }
  
  try {
    const [pedidos] = await pool.query(
      `SELECT p.*, 
        (SELECT GROUP_CONCAT(CONCAT(pr.nombre, ' (x', dp.cantidad, ')') SEPARATOR ', ')
         FROM detalles_pedido dp
         JOIN productos pr ON dp.producto_id = pr.id
         WHERE dp.pedido_id = p.id) as productos
       FROM pedidos p
       WHERE p.usuario_id = ?
       ORDER BY p.fecha DESC`,
      [req.session.usuario.id]
    );
    
    res.render('historial', { pedidos });
  } catch (error) {
    console.error('Error al cargar historial:', error);
    res.status(500).send('Error al cargar el historial');
  }
});

// Generar PDF del ticket
app.get('/ticket/:pedido_id', async (req, res) => {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }
  
  const pedido_id = req.params.pedido_id;
  
  try {
    // Obtener datos del pedido
    const [pedidos] = await pool.query(
      'SELECT * FROM pedidos WHERE id = ? AND usuario_id = ?',
      [pedido_id, req.session.usuario.id]
    );
    
    if (pedidos.length === 0) {
      return res.status(404).send('Pedido no encontrado');
    }
    
    const pedido = pedidos[0];
    
    // Obtener detalles del pedido
    const [detalles] = await pool.query(
      `SELECT dp.*, p.nombre, p.descripcion
       FROM detalles_pedido dp
       JOIN productos p ON dp.producto_id = p.id
       WHERE dp.pedido_id = ?`,
      [pedido_id]
    );
    
    // Crear PDF
    const doc = new PDFDocument({ margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=ticket-${pedido_id}.pdf`);
    
    doc.pipe(res);
    
    // Encabezado
    doc.fontSize(20).text('TIENDA ANIME', { align: 'center' });
    doc.fontSize(16).text('Ticket de Compra', { align: 'center' });
    doc.moveDown();
    
    // Información del pedido
    doc.fontSize(12).text(`Pedido #${pedido.id}`, { align: 'left' });
    doc.text(`Fecha: ${new Date(pedido.fecha).toLocaleString('es-MX')}`);
    doc.text(`Cliente: ${req.session.usuario.nombre}`);
    doc.text(`Email: ${req.session.usuario.email}`);
    doc.moveDown();
    
    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();
    
    // Detalles de productos
    doc.fontSize(14).text('Productos:', { underline: true });
    doc.moveDown(0.5);
    
    detalles.forEach((detalle, index) => {
      doc.fontSize(11).text(
        `${index + 1}. ${detalle.nombre}`,
        { continued: false }
      );
      doc.fontSize(10).text(
        `   Cantidad: ${detalle.cantidad} x $${detalle.precio.toFixed(2)} = $${(detalle.cantidad * detalle.precio).toFixed(2)}`,
        { indent: 20 }
      );
      doc.moveDown(0.5);
    });
    
    doc.moveDown();
    
    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();
    
    // Total
    doc.fontSize(14).text(`TOTAL: $${pedido.total.toFixed(2)}`, { align: 'right', bold: true });
    doc.moveDown();
    
    // Pie de página
    doc.fontSize(10).text('¡Gracias por tu compra!', { align: 'center' });
    doc.text('Tienda Anime - Tu tienda de coleccionables favorita', { align: 'center' });
    
    doc.end();
  } catch (error) {
    console.error('Error al generar ticket:', error);
    res.status(500).send('Error al generar el ticket');
  }
});

// Descargar ticket como PDF
app.get('/ticket/:pedido_id/pdf', async (req, res) => {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }
  
  const pedido_id = req.params.pedido_id;
  
  try {
    // Obtener datos del pedido
    const [pedidos] = await pool.query(
      'SELECT * FROM pedidos WHERE id = ? AND usuario_id = ?',
      [pedido_id, req.session.usuario.id]
    );
    
    if (pedidos.length === 0) {
      return res.status(404).send('Pedido no encontrado');
    }
    
    const pedido = pedidos[0];
    
    // Obtener detalles del pedido
    const [detalles] = await pool.query(
      `SELECT dp.*, p.nombre, p.descripcion
       FROM detalles_pedido dp
       JOIN productos p ON dp.producto_id = p.id
       WHERE dp.pedido_id = ?`,
      [pedido_id]
    );
    
    // Crear PDF
    const doc = new PDFDocument({ margin: 50 });
    
    // Configurar headers para descarga
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=ticket-${pedido_id}.pdf`);
    
    // Pipe el PDF directamente a la respuesta
    doc.pipe(res);
    
    // Encabezado
    doc.fontSize(24).text('TIENDA ANIME', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(18).text('Ticket de Compra', { align: 'center' });
    doc.moveDown(1.5);
    
    // Información del pedido
    doc.fontSize(12).text(`Pedido #${pedido.id}`);
    doc.text(`Fecha: ${new Date(pedido.fecha).toLocaleString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`);
    doc.text(`Cliente: ${req.session.usuario.nombre}`);
    doc.text(`Email: ${req.session.usuario.email}`);
    doc.moveDown(1.5);
    
    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();
    
    // Detalles de productos
    doc.fontSize(14).text('Productos:', { underline: true });
    doc.moveDown(0.5);
    
    detalles.forEach((detalle, index) => {
      const precio = parseFloat(detalle.precio);
      const cantidad = parseInt(detalle.cantidad);
      const subtotal = precio * cantidad;
      
      doc.fontSize(11).text(`${index + 1}. ${detalle.nombre}`);
      doc.fontSize(10).text(`   Cantidad: ${cantidad} x $${precio.toFixed(2)} = $${subtotal.toFixed(2)} MXN`);
      doc.moveDown(0.5);
    });
    
    doc.moveDown();
    
    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();
    
    // Total
    const total = parseFloat(pedido.total);
    doc.fontSize(16).text(`TOTAL: $${total.toFixed(2)} MXN`, { align: 'right' });
    doc.moveDown(2);
    
    // Pie de página
    doc.fontSize(10).text('¡Gracias por tu compra!', { align: 'center' });
    doc.text('Tienda Anime - Tu tienda de coleccionables favorita', { align: 'center' });
    
    // Finalizar el PDF
    doc.end();
  } catch (error) {
    console.error('Error al generar PDF:', error);
    res.status(500).send('Error al generar el ticket PDF');
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});