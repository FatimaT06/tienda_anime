// Función para mostrar notificaciones
function mostrarNotificacion(mensaje, tipo = 'success') {
  const notificacion = document.getElementById('notificacion');
  notificacion.textContent = mensaje;
  notificacion.className = `notificacion ${tipo} show`;
  
  setTimeout(() => {
    notificacion.classList.remove('show');
  }, 3000);
}

// Función para agregar al carrito
async function agregarAlCarrito(productoId) {
  try {
    const response = await fetch('/carrito/agregar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ producto_id: productoId })
    });
    
    const data = await response.json();
    
    if (data.success) {
      mostrarNotificacion('¡Producto agregado al carrito!', 'success');
      
      // Actualizar badge del carrito
      const badge = document.getElementById('carrito-count');
      if (badge) {
        const total = data.carrito.reduce((sum, item) => sum + item.cantidad, 0);
        badge.textContent = total;
      }
    } else {
      mostrarNotificacion('Error al agregar el producto', 'error');
    }
  } catch (error) {
    console.error('Error:', error);
    mostrarNotificacion('Error al agregar el producto', 'error');
  }
}