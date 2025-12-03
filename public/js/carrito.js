// Función para mostrar notificaciones
function mostrarNotificacion(mensaje, tipo = 'success') {
  const notificacion = document.getElementById('notificacion');
  notificacion.textContent = mensaje;
  notificacion.className = `notificacion ${tipo} show`;
  
  setTimeout(() => {
    notificacion.classList.remove('show');
  }, 3000);
}

// Función para actualizar cantidad
async function actualizarCantidad(productoId, nuevaCantidad) {
  if (nuevaCantidad < 1) return;
  
  try {
    const response = await fetch('/carrito/actualizar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        producto_id: productoId, 
        cantidad: nuevaCantidad 
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      location.reload();
    } else {
      mostrarNotificacion('Error al actualizar cantidad', 'error');
    }
  } catch (error) {
    console.error('Error:', error);
    mostrarNotificacion('Error al actualizar cantidad', 'error');
  }
}

// Función para eliminar del carrito
async function eliminarDelCarrito(productoId) {
  if (!confirm('¿Estás seguro de eliminar este producto?')) return;
  
  try {
    const response = await fetch('/carrito/eliminar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ producto_id: productoId })
    });
    
    const data = await response.json();
    
    if (data.success) {
      mostrarNotificacion('Producto eliminado del carrito', 'success');
      setTimeout(() => {
        location.reload();
      }, 1000);
    } else {
      mostrarNotificacion('Error al eliminar producto', 'error');
    }
  } catch (error) {
    console.error('Error:', error);
    mostrarNotificacion('Error al eliminar producto', 'error');
  }
}

// Función para realizar compra
async function realizarCompra() {
  if (!confirm('¿Confirmar compra?')) return;
  
  const btnComprar = document.querySelector('.btn-comprar');
  btnComprar.disabled = true;
  btnComprar.textContent = 'Procesando...';
  
  try {
    const response = await fetch('/carrito/comprar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    const data = await response.json();
    
    if (data.success) {
      mostrarNotificacion('¡Compra realizada con éxito!', 'success');
      
      setTimeout(() => {
        window.location.href = '/historial';
      }, 1000);
    } else {
      mostrarNotificacion(data.error || 'Error al realizar la compra', 'error');
      btnComprar.disabled = false;
      btnComprar.textContent = 'Realizar Compra';
    }
  } catch (error) {
    console.error('Error:', error);
    mostrarNotificacion('Error al realizar la compra', 'error');
    btnComprar.disabled = false;
    btnComprar.textContent = 'Realizar Compra';
  }
}