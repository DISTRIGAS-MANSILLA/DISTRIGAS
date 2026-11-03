# DISTRIGAS — Inicio de desarrollo

## 1) Instalar el paquete inicial
En `C:\Users\nelso\DISTRIGAS`, extraer el ZIP conservando sus subcarpetas. Sobrescribir solo `src/App.jsx`, `src/index.css`, `src/main.jsx` si Windows lo pregunta. No borrar `.git`, `package.json`, `package-lock.json` ni `node_modules`.

## 2) Conectar el Firebase del dueño
En Firebase Console > Configuración del proyecto > General > Tus aplicaciones > seleccionar la app web elegida > Configuración del SDK > Configuración, copiar los seis valores a `.env.local` (copia de `.env.example`). Estos datos son identificadores de cliente, **no** claves de cuenta de servicio. No compartir `.env.local` por GitHub. Verificar que `.gitignore` contenga `*.local`.

## 3) Preparar seguridad
En Firebase Authentication > Usuarios, crear el usuario administrador inicial (correo y contraseña), o utilizar uno existente. Copiar su UID.

En Firestore > Datos > colección `users` > documento con ID exacto del UID > campos string:
- `name`: nombre del propietario
- `role`: `owner`

El rol debe ser literalmente `owner`. El sistema no otorga permisos automáticamente al usuario que inicia sesión. Para otros empleados, usar roles `admin`, `warehouse` o `viewer`. El alta se realiza en consola por el propietario o administrador técnico autorizado.

## 4) Publicar reglas antes de registrar operaciones reales
En Firestore > Reglas, colocar contenido de `firestore.rules`, guardar y publicar. Si hay otras aplicaciones o reglas existentes en el proyecto, revisar compatibilidad antes de sustituirlas. Las reglas de esta versión solo contemplan las colecciones `users`, `inventory` y `movements`.

## 5) Ejecutar
En PowerShell dentro del proyecto:
```
npm.cmd run dev
```
Abrir http://localhost:5173. Iniciar sesión con el usuario de Authentication. Verificar panel e inventario. No registrar datos reales antes de hacer el conteo físico inicial y probar todas las operaciones con datos de ensayo.

## 6) Qué incluye esta versión
- Inicio de sesión Firebase Authentication.
- Validación de perfil existente en Firestore.
- Panel con existencias sincronizadas.
- Control de garrafas 10 kg y 45 kg (llenas, vacías, dañadas).
- Movimientos auditados por usuario y hora con transacciones de Firestore.
- Vista básica adaptable a celular.

No incluye todavía rutas, ventas por chofer, caja, devoluciones complejas, recalificación, reposición YPFB ni reportes financieros. **No confundir intercambio del almacén con una venta facturada**.

## 7) Observaciones de seguridad y calidad
Las reglas evitan lectura pública y operaciones para roles no autorizados; pero para producción deben reforzarse las invariantes de inventario y la asociación atómica movimiento+saldo mediante backend de confianza o reglas con `getAfter`. En esta primera versión, los usuarios con permisos de edición pueden alterar inventario desde clientes modificados; solo utilizar con administradores de confianza y datos de prueba. El inventario no puede considerarse un sistema de auditoría antifraude certificado. Mantener respaldos externos, pruebas de restauración y controles de conteo.

## 8) Compilar
```
npm.cmd run build
```
No publicar antes de verificar seguridad y hacer respaldo inicial.
