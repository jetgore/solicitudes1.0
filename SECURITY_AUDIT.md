# 🔒 AUDITORÍA DE SEGURIDAD - PROYECTO SOLICITUDES

**Fecha:** 29 de Abril de 2026  
**Severidad:** CRÍTICA, ALTA, MEDIA, BAJA

---

## ⚠️ PROBLEMAS CRÍTICOS

### 1. **EXPOSICIÓN DE CREDENCIALES FIREBASE** ⚠️ CRÍTICA
**Ubicación:** `frontend/script.js` línea 24-31  
**Problema:**  
```javascript
const DEFAULT_CFG = {
  apiKey:            'AIzaSyD4jVqJQd-jA9D6L7ZNneBcTMZ7zF3yShk',
  authDomain:        'solicitudes-f2ce8.firebaseapp.com',
  projectId:         'solicitudes-f2ce8',
  // ... más credenciales
};
```
- Las credenciales de Firebase están **hardcodeadas en el código fuente**
- Son **visibles en el navegador** en el DevTools
- Un atacante puede usar estas credenciales para acceder a la BD
- Los archivos también están en `subir_inventario.html`

**Riesgo:** 🔴 CRÍTICO - Acceso no autorizado a datos  
**Recomendación:**
- Mover credenciales a variable de entorno (`.env`)
- Usar un servidor backend para inicializar Firebase con Admin SDK
- Implementar Firebase Rules restrictivas en Firestore

---

### 2. **FALTA DE VALIDACIÓN DE ENTRADA** ⚠️ CRÍTICA
**Ubicación:** Múltiples campos del formulario  
**Problema:**
- Sin validación en campos de usuario, dirección, BCS, SCI
- Posible inyección de datos malformados en Firestore
- No se valida longitud de strings ni tipos de datos
- Campos numéricos aceptan cualquier valor

**Riesgo:** 🔴 CRÍTICO - Inyección de datos, DoS  
**Recomendación:**
```javascript
function validarFormulario() {
  const sol = document.getElementById('fSolicitud').value.trim();
  if (!sol || sol.length > 50) { toast('Solicitud inválida', 'error'); return false; }
  
  const usr = document.getElementById('fUsuario').value.trim();
  if (!usr || usr.length > 100) { toast('Usuario inválido', 'error'); return false; }
  
  // Validar patrón: BCS-XXXXX
  const bcs = document.getElementById('fBcs').value.trim();
  if (bcs && !/^BCS-[A-Z0-9]+$/.test(bcs)) { ... }
  
  return true;
}
```

---

### 3. **CONTROL DE ACCESO INSUFICIENTE** ⚠️ CRÍTICA
**Ubicación:** `script.js` línea 1016-1018  
**Problema:**
```javascript
if (!(currentRole === 'admin' || r.uid === currentUser.uid)) {
  toast('No tienes permiso', 'error');
  return;
}
```
- **Validación solo en frontend** - Fácil de bypassear
- No hay validación en Firestore Rules
- Un atacante puede editar registros de otros usuarios modificando el JS

**Riesgo:** 🔴 CRÍTICO - Acceso no autorizado a datos  
**Recomendación:** Implementar Firestore Security Rules:
```javascript
match /solicitudes/{document=**} {
  allow read, update, delete: if request.auth.uid == resource.data.uid || isAdmin();
  allow create: if request.auth != null;
}
```

---

### 4. **ALMACENAMIENTO INSEGURO EN LOCALSTORAGE** ⚠️ ALTA
**Ubicación:** `script.js` línea 297, 311-314  
**Problema:**
```javascript
localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
```
- **localStorage es vulnerable a XSS**
- Si hay vulnerabilidad XSS, atacante accede a credenciales
- No hay encriptación de datos sensibles

**Riesgo:** 🟠 ALTO - Robo de credenciales  
**Recomendación:**
- Usar sessionStorage en lugar de localStorage (se limpia al cerrar)
- O mejor aún, no almacenar credenciales en el cliente
- Si se almacena, encriptar con algoritmo AES

---

## 🟠 PROBLEMAS ALTOS

### 5. **INFORMACIÓN SENSIBLE EN LOGS Y CONSOLA**
**Ubicación:** `script.js` múltiples `console.log()`  
**Problema:**
```javascript
console.log('[AuthStateChanged] user:', user);
console.log('[ResetPassword] currentUser:', user);
```
- Los logs contienen información de usuarios
- Visibles en DevTools de navegador
- Podrían contener errores con credenciales

**Riesgo:** 🟠 ALTO - Exposición de datos  
**Recomendación:** Remover todos los `console.log()` en producción o usar logger seguro

---

### 6. **FALTA DE RATE LIMITING EN LOGIN**
**Ubicación:** `script.js` línea 431-450  
**Problema:**
- Sin limitación de intentos de login
- Vulnerable a ataques de fuerza bruta
- Firebase tiene limitación débil por defecto

**Riesgo:** 🟠 ALTO - Ataque de fuerza bruta  
**Recomendación:** Implementar rate limiting en cliente:
```javascript
let loginAttempts = 0;
let loginLocked = false;

if (loginAttempts >= 5) {
  loginLocked = true;
  setTimeout(() => { loginLocked = false; loginAttempts = 0; }, 900000); // 15 min
}
```

---

### 7. **FUNCIONES DE ADMIN OCULTAS EN FRONTEND**
**Ubicación:** `index.html` línea 183-192  
**Problema:**
```html
<div class="view admin-only" id="view-importar" style="display:none">
<div class="view admin-only" id="view-config" style="display:none">
```
- Las vistas admin solo están **ocultas con CSS**
- Un usuario puede acceder con `document.getElementById('view-config').style.display = 'block'`

**Riesgo:** 🟠 ALTO - Escalación de privilegios  
**Recomendación:** No renderizar las vistas en HTML si no es admin:
```javascript
if (currentRole === 'admin') {
  renderAdminViews();
}
```

---

### 8. **SIN PROTECCIÓN CONTRA CSRF**
**Ubicación:** Acciones sensibles en formularios  
**Problema:**
- Sin tokens CSRF
- Las acciones destructivas (eliminar) solo usan dataset ID
- Una página maliciosa podría invocar acciones

**Riesgo:** 🟠 ALTO - CSRF attacks  
**Recomendación:** Implementar confirmación con modal y tokens

---

## 🟡 PROBLEMAS MEDIOS

### 9. **VALIDACIÓN DÉBIL DE ROLES**
**Ubicación:** `script.js` línea 370-378  
**Problema:**
- El rol se obtiene de Firestore sin validación
- No hay caché seguro del rol
- Si Firestore se compromete, cualquiera puede ser admin

**Riesgo:** 🟡 MEDIO - Escalación de privilegios  
**Recomendación:** Usar Firebase Custom Claims (más seguro)

---

### 10. **FALTA DE ENCRIPTACIÓN EN TRÁNSITO**
**Ubicación:** Configuración de servidor  
**Problema:**
- Apache podría servir sin HTTPS
- Los datos se transmiten en claro
- Firebase requiere HTTPS

**Riesgo:** 🟡 MEDIO - Man-in-the-middle  
**Recomendación:** Obligar HTTPS en Apache:
```apache
<VirtualHost *:80>
  Redirect permanent / https://dominio.com/
</VirtualHost>
```

---

### 11. **SIN MANEJO SEGURO DE ERRORES**
**Ubicación:** Múltiples catch blocks  
**Problema:**
```javascript
.catch(e => {
  toast('Error: ' + e.message, 'error');
  console.log(e); // Revela detalles técnicos
});
```
- Los mensajes de error revelan detalles técnicos
- Stack traces visibles en producción

**Riesgo:** 🟡 MEDIO - Information disclosure  
**Recomendación:** Mostrar errores genéricos al usuario

---

### 12. **COOKIES SIN FLAGS SEGUROS**
**Ubicación:** No implementado  
**Problema:**
- Si se usan cookies, sin HttpOnly, Secure, SameSite flags
- Vulnerable a XSS si hay cookies

**Riesgo:** 🟡 MEDIO - Robo de cookies  
**Recomendación:** Si usas cookies en backend:
```
Set-Cookie: sessionId=xxx; HttpOnly; Secure; SameSite=Strict
```

---

## 🔵 PROBLEMAS BAJOS / MEJORAS

### 13. **SIN POLÍTICA DE SEGURIDAD DE CONTENIDO (CSP)**
**Ubicación:** No implementado  
**Problema:**
- Sin headers CSP
- Vulnerable a inyecciones de script

**Recomendación:**
```apache
Header set Content-Security-Policy "default-src 'self'; script-src 'self' https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
```

---

### 14. **SIN PROTECCIÓN X-FRAME-OPTIONS**
**Ubicación:** No implementado  
**Problema:**
- Vulnerable a clickjacking
- La app podría incrustarse en un iframe malicioso

**Recomendación:**
```apache
Header set X-Frame-Options "SAMEORIGIN"
```

---

### 15. **FECHA DE Firebase TIMESTAMP NO VALIDADA**
**Ubicación:** `script.js` línea 74-84  
**Problema:**
- formatFecha() no valida tipo de dato
- Si llega un timestamp corrupto, puede causar error

**Recomendación:**
```javascript
function formatFecha(ts) {
  if (!ts || typeof ts !== 'object') return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (!(d instanceof Date) || isNaN(d)) return '—';
    return d.toLocaleDateString('es-CL', {...});
  } catch(e) { return '—'; }
}
```

---

## 📋 CHECKLIST DE ACCIONES RECOMENDADAS

### Urgentes (Semana 1)
- [ ] Mover credenciales a `.env` 
- [ ] Implementar Firestore Security Rules
- [ ] Agregar validación de entrada en todos los campos
- [ ] Remover console.log() de producción
- [ ] Forzar HTTPS en Apache

### Importantes (Semana 2-3)
- [ ] Implementar rate limiting en login
- [ ] No renderizar vistas admin en HTML si no es admin
- [ ] Agregar tokens CSRF en acciones sensibles
- [ ] Implementar confirmación modal para delete
- [ ] Migrar a Custom Claims en Firebase

### Mejoras (Semana 4+)
- [ ] Agregar CSP headers
- [ ] Agregar X-Frame-Options
- [ ] Implementar WAF (Web Application Firewall)
- [ ] Auditoría de seguridad profesional
- [ ] Penetration testing

---

## 🛡️ RESUMEN DE RIESGOS

| Severidad | Cantidad | Ejemplos |
|-----------|----------|----------|
| 🔴 CRÍTICA | 3 | Credenciales expuestas, Sin validación, Control acceso débil |
| 🟠 ALTA | 5 | localStorage inseguro, Admin UI visible, Rate limiting |
| 🟡 MEDIA | 4 | Validación de roles, Sin HTTPS, Errores reveladores |
| 🔵 BAJA | 3 | CSP, X-Frame-Options, Validación timestamps |

**Score de Seguridad Actual: 3/10** 🔴

**Score Esperado Después de Correcciones: 7/10** 🟡

---

**Auditoría realizada por:** GitHub Copilot  
**Recomendación:** Implementar urgentemente los problemas CRÍTICOS antes de pasar a producción
