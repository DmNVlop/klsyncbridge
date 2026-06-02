# KLSyncBridge — Guía Completa de Usuario

---

## ¿Qué es KLSyncBridge?

KLSyncBridge es un servicio que corre en un servidor Windows de su empresa. Su función es leer datos de la base de datos SQL Server y enviarlos automáticamente a un sistema externo (una API en la nube), según un horario que usted configura.

Una vez configurado, trabaja solo. No requiere intervención diaria.

---

## PARTE 1 — Puesta en marcha (técnico instalador)

Esta sección la ejecuta **una sola vez** el técnico instalador. Los operarios pueden saltarla.

### Requisitos previos

- Windows 10 / Server 2016 o superior
- Node.js 24 LTS instalado ([nodejs.org](https://nodejs.org))
- Acceso de administrador local al servidor
- Credenciales de lectura a la base de datos SQL Server del cliente

### 1.1 — Instalar los archivos

Copiar la carpeta del proyecto al servidor. Ubicación recomendada:

```
C:\KLSyncBridge\
```

**¿Qué archivos se copian?**

La carpeta de distribución contiene esto (y solo esto):

```
C:\KLSyncBridge\
  src\              ← Código del servicio
  public\           ← Interfaz web
  scripts\          ← Scripts de instalación
  docs\             ← Esta guía y documentación
  package.json
  package-lock.json
```

**Lo que NO se incluye en la distribución** (se genera automáticamente en los pasos siguientes):

| Carpeta/archivo | Por qué no se copia |
|---|---|
| `node_modules\` | Se genera con `npm install` en el paso 1.2 |
| `data\` | Se genera con `node scripts/setup.js` en el paso 1.3 |
| `logs\` | Se genera automáticamente al arrancar el servicio |

> **IMPORTANTE — Nunca reutilizar `data\` de otra instalación.** Cada instalación tiene su propia clave de cifrado (`data/encryption.key`). Copiar la carpeta `data\` de un servidor a otro dejará las contraseñas cifradas ilegibles.

### 1.2 — Ejecutar el instalador

Dentro de la carpeta del proyecto, hacer **clic derecho** en `instalar.bat` y seleccionar **"Ejecutar como administrador"**.

El script hace todo automáticamente:

1. Instala las dependencias de Node.js
2. Genera la clave de cifrado, la base de datos y el usuario administrador inicial
3. Registra e inicia el servicio Windows
4. Crea un acceso directo en el **Escritorio** y en el **Menú Inicio**
5. Abre el navegador en `http://localhost:3847` al terminar

Durante el proceso aparecerán las credenciales iniciales:

```
╔══════════════════════════════════════════╗
║         CREDENCIALES INICIALES           ║
╠══════════════════════════════════════════╣
║  Usuario:    admin                       ║
║  Contraseña: a3f9c12e8b7d4501            ║
╠══════════════════════════════════════════╣
║  ⚠️  CAMBIA LA CONTRASEÑA INMEDIATAMENTE  ║
╚══════════════════════════════════════════╝
```

> **IMPORTANTE:** Anotar esas credenciales antes de cerrar la ventana. La contraseña no se puede recuperar después.

A partir de aquí el servicio corre solo. Arranca automáticamente con Windows — no hace falta tener ninguna consola abierta.

Para acceder a la interfaz en el futuro: usar el **acceso directo del Escritorio** o abrir `http://localhost:3847` en el navegador.

### 1.6 — Cambiar la contraseña del admin

Entrar a `http://localhost:3847` → menú **Usuarios** → botón **Cambiar contraseña** en la fila de `admin`. Poner una contraseña segura.

### 1.7 — Crear cuentas para los operarios (opcional)

Si habrá más personas usando el sistema:
- Menú **Usuarios** → **Nuevo usuario**
- Asignar rol **Administrador** (puede hacer todo) u **Operario** (solo lectura y ejecución manual)

---

## PARTE 2 — Configuración inicial del sistema

Esta sección la hace el técnico instalador o el administrador de la empresa. Solo se hace una vez por cada conexión o API que se quiera usar.

### 2.1 — Configurar la conexión a SQL Server

Ir a **Conexiones** en el menú lateral → **Nueva conexión**.

| Campo | Qué poner | Ejemplo |
|---|---|---|
| Nombre | Nombre descriptivo para identificarla | `Base de datos Producción` |
| Servidor | IP o nombre del servidor SQL | `192.168.1.10` o `SERVIDOR\SQLEXPRESS` |
| Puerto | Puerto SQL Server (casi siempre 1433) | `1433` |
| Base de datos | Nombre exacto de la base de datos | `EmpresaDB` |
| Usuario | Usuario con permiso de lectura | `syncuser` |
| Contraseña | Contraseña del usuario SQL | `••••••••` |
| Cifrar conexión | Activar si el servidor requiere SSL | Depende del servidor |
| Confiar en certificado | Activar si hay errores de certificado | Activar si es red local |

Después de completar, hacer clic en **Probar conexión**. Debe aparecer un mensaje verde de éxito. Si no, revisar los datos.

Hacer clic en **Guardar**.

> La contraseña se guarda cifrada en la base de datos local. Nunca aparece en texto plano.

### 2.2 — Configurar la API destino

Ir a **APIs** en el menú → **Nueva API**.

| Campo | Qué poner | Ejemplo |
|---|---|---|
| Nombre | Nombre descriptivo | `API Ventas Cloud` |
| URL base | Dirección raíz del sistema destino | `https://api.miempresa.com` |
| Endpoint | Ruta específica donde se envían los datos | `/v1/ventas` |
| Método | Método HTTP que espera la API | `POST` |
| Tipo de autenticación | Según lo que indique el proveedor | Ver tabla abajo |

**Tipos de autenticación disponibles:**

| Tipo | Cuándo usarlo | Campos adicionales |
|---|---|---|
| Sin autenticación | APIs públicas o en red interna | — |
| Bearer Token | La API da un token fijo | Token |
| API Key | La API usa una clave en header o parámetro | Nombre de la clave, Valor, Ubicación (header/query) |
| Basic | Usuario y contraseña HTTP estándar | Usuario, Contraseña |
| Login automático | La API requiere login previo para obtener token | URL de login, Usuario, Contraseña, Ruta del token en la respuesta |

Hacer clic en **Probar conexión** para verificar que la API responde. Luego **Guardar**.

---

## PARTE 3 — Crear una tarea de sincronización

Las tareas son el corazón del sistema. Cada tarea define qué datos leer, adónde enviarlos y cuándo.

Ir a **Tareas** → **Nueva tarea**. Se abre un asistente de 4 pasos.

---

### Paso 1 — Origen de los datos

**Conexión:** Seleccionar la conexión SQL Server configurada en el paso 2.1.

**Tabla o vista:** El sistema se conecta y muestra la lista de tablas y vistas disponibles. Seleccionar la que contiene los datos a sincronizar.

**Campo clave:** El identificador único de cada registro (normalmente `ID`, `Codigo`, `NumeroDocumento`). Se usa para saber qué registros son nuevos en modo incremental.

**Modo de sincronización:**

| Modo | Qué hace | Cuándo usarlo |
|---|---|---|
| **Completo** | Envía TODOS los registros cada vez | Tablas pequeñas, o cuando siempre se necesita enviar todo |
| **Incremental** | Solo envía los registros nuevos o modificados desde la última ejecución | Tablas grandes, sincronizaciones frecuentes |

> En modo incremental también se puede configurar un **campo de fecha** (ej: `FechaModificacion`) para filtrar por fecha de última actualización.

---

### Paso 2 — Destino

Seleccionar la configuración de API destino configurada en el paso 2.2.

---

### Paso 3 — Mapeo de campos

Aquí se define la correspondencia entre los campos de SQL Server y los campos que espera la API.

La interfaz muestra una tabla. Por cada campo de la API destino:

1. Seleccionar el **campo SQL** de origen (desplegable con todos los campos de la tabla)
2. Opcionalmente elegir una **transformación:**

| Transformación | Qué hace |
|---|---|
| Ninguna | Envía el valor tal cual |
| MAYÚSCULAS | Convierte texto a mayúsculas |
| minúsculas | Convierte texto a minúsculas |
| Recortar espacios | Elimina espacios al inicio y fin |
| Número | Convierte a número |
| Booleano | Convierte a true/false |
| Fecha ISO | Convierte fecha a formato ISO 8601 |
| Texto | Convierte cualquier valor a texto |

3. Si el campo no tiene valor en SQL, se puede poner un **valor por defecto**

En el lado derecho aparece un **preview en tiempo real** mostrando cómo quedaría el JSON que se enviará a la API.

---

### Paso 4 — Programación

Define cuándo se ejecuta la tarea automáticamente.

**Opción A — Por intervalo (más simple):**

Escribir cada cuántos minutos debe ejecutarse.

| Valor | Resultado |
|---|---|
| `15` | Cada 15 minutos |
| `60` | Cada hora |
| `120` | Cada 2 horas |
| `1440` | Una vez al día |

**Opción B — Expresión cron (más control):**

Para programaciones específicas. Ejemplos:

| Expresión | Cuándo se ejecuta |
|---|---|
| `0 6 * * *` | Todos los días a las 6:00 AM |
| `0 6 * * 1-5` | Lunes a viernes a las 6:00 AM |
| `0 */2 * * *` | Cada 2 horas |
| `0 8,12,18 * * *` | A las 8:00, 12:00 y 18:00 |
| `*/30 * * * *` | Cada 30 minutos |

> Si tiene dudas con la expresión cron, usar la opción de intervalo.

Hacer clic en **Guardar tarea**.

---

## PARTE 4 — Uso diario

### El dashboard

Al entrar al sistema, la pantalla principal muestra:

- **Tareas activas:** cuántas están programadas y corriendo
- **Última ejecución:** cuándo corrió cada tarea por última vez
- **Estado:** si la última ejecución fue exitosa o tuvo error
- **Próxima ejecución:** cuándo correrá la siguiente vez

El dashboard se actualiza automáticamente cada 30 segundos. No hace falta recargar la página.

### Ejecutar una tarea manualmente

En el menú **Tareas**, cada fila tiene el botón **Ejecutar ahora**. Útil para probar o forzar una sincronización fuera del horario.

### Activar o desactivar una tarea

En la lista de **Tareas**, el interruptor de la columna **Activo** pausa o reactiva la tarea. Una tarea desactivada no se ejecuta automáticamente, pero sí puede ejecutarse con **Ejecutar ahora**.

### Ver resultados y errores

Ir a **Logs** en el menú.

Cada fila es una ejecución. Las columnas más importantes:

| Columna | Significado |
|---|---|
| Estado | Exitoso / Error / En ejecución |
| Registros leídos | Cuántos registros leyó de SQL Server |
| Registros enviados | Cuántos llegaron correctamente a la API |
| Duración | Cuánto tardó la ejecución |
| Error | Si falló, el motivo |

Hacer clic en una fila muestra el detalle completo de esa ejecución.

**Filtros disponibles:**
- Por tarea específica
- Por estado (exitoso / error)
- Por rango de fechas

---

## PARTE 5 — Gestión de usuarios

> Solo para usuarios con rol **Administrador**.

Menú **Usuarios**.

### Crear un usuario

1. Clic en **Nuevo usuario**
2. Ingresar nombre de usuario (sin espacios, mínimo 3 caracteres)
3. Ingresar contraseña (mínimo 8 caracteres)
4. Seleccionar rol:
   - **Administrador:** acceso total (crear/editar/eliminar todo, gestionar usuarios)
   - **Operario:** puede ver y ejecutar tareas manualmente, pero no puede modificar configuraciones
5. Clic en **Guardar**

### Cambiar contraseña de un usuario

Fila del usuario → **Restablecer contraseña**.

### Desactivar un usuario

Interruptor en la columna **Activo**. El usuario no podrá iniciar sesión, pero sus datos se conservan. Útil cuando un empleado deja la empresa.

> El usuario **admin** original (master) no puede ser desactivado ni eliminado.

---

## PARTE 6 — Configuración general

> Solo para usuarios con rol **Administrador**.

Menú **Configuración**.

| Opción | Qué hace |
|---|---|
| Puerto de la interfaz | Cambiar el puerto de acceso web (requiere reiniciar el servicio) |
| Retención de logs | Cuántos días se guardan los registros de ejecución (por defecto 30 días) |

---

## PARTE 7 — Mantenimiento

### Reiniciar el servicio

Si es necesario reiniciar el servicio (tras cambio de puerto, actualización, etc.):

```powershell
# Desde PowerShell como Administrador:
Restart-Service KLSyncBridge

# O desde services.msc: clic derecho en KLSyncBridge → Reiniciar
```

### Desinstalar el servicio

```powershell
cd C:\KLSyncBridge
node scripts/uninstall-service.js
```

Los datos en `data/` y los logs en `logs/` se conservan.

### Archivos importantes — NO borrar

| Archivo | Propósito |
|---|---|
| `data/klsyncbridge.db` | Base de datos con toda la configuración |
| `data/encryption.key` | Clave de cifrado de contraseñas |

> Si se pierden estos archivos, se pierde toda la configuración y las credenciales cifradas.

### Backup recomendado

Copiar periódicamente la carpeta `data/` a una ubicación segura. Con eso es suficiente para restaurar el sistema completo.

### Actualizar KLSyncBridge

1. Detener el servicio en `services.msc` → KLSyncBridge → Detener
2. Reemplazar los archivos del proyecto (excepto la carpeta `data/`)
3. Ejecutar `npm install`
4. Iniciar el servicio en `services.msc` → KLSyncBridge → Iniciar

---

## PARTE 8 — Acceder al sistema sin el acceso directo

Si se eliminó el acceso directo del Escritorio, hay tres formas de volver a acceder:

### Opción A — Abrir el navegador manualmente

En el servidor donde está instalado KLSyncBridge, abrir cualquier navegador web y escribir:

```
http://localhost:3847
```

Funciona siempre que el servicio esté en ejecución.

### Opción B — Recrear el acceso directo desde la interfaz web

1. Abrir `http://localhost:3847` en el navegador (Opción A)
2. Ir al menú **Sistema**
3. En la sección **Acceso directo**, hacer clic en **Recrear acceso directo**
4. El acceso directo se crea nuevamente en el Escritorio y en el Menú Inicio

### Opción C — Recrear el acceso directo manualmente

Si ninguna de las opciones anteriores funciona, crear un archivo llamado `KLSyncBridge.url` en el Escritorio con este contenido:

```ini
[InternetShortcut]
URL=http://localhost:3847
```

---

## Personalizar el ícono del acceso directo

El acceso directo en el Escritorio usa el archivo `public/favicon.ico` como ícono. Si se quiere mostrar el logo de la empresa o del producto:

**Formato requerido:** `.ico` con múltiples resoluciones (16×16, 32×32, 48×48, 256×256 en un solo archivo).

**Cómo crear el `.ico`:**
1. Tener el logo en formato PNG (fondo transparente recomendado)
2. Convertirlo a `.ico` con alguna herramienta online (buscar "png to ico converter")
3. Guardar el resultado como `public/favicon.ico` en la carpeta del proyecto

**Cómo aplicarlo:**
- En una instalación nueva: el `instalar.bat` lo toma automáticamente
- En una instalación existente: ir a **Sistema → Recrear acceso directo** en la interfaz web

> Si no existe `public/favicon.ico`, el acceso directo funciona igual pero muestra el ícono genérico del navegador.

---

## PARTE 9 — Resolución de problemas

### La interfaz web no carga

1. Verificar en `services.msc` que KLSyncBridge está **En ejecución**
2. Verificar la URL: `http://localhost:3847`
3. Revisar el log: `logs/app-YYYY-MM-DD.log`

### Una tarea aparece en error

1. Ir a **Logs** → buscar la ejecución fallida → clic para ver el detalle
2. El mensaje de error indica la causa:

| Mensaje | Causa y solución |
|---|---|
| `Error de conexión SQL Server` | El servidor SQL no está disponible o las credenciales cambiaron. Verificar en **Conexiones** → Probar conexión. |
| `Error de autenticación` | El token o credenciales de la API cambiaron. Actualizar en **APIs**. |
| `La tarea no tiene mapeos de campos configurados` | Volver al editor de la tarea y completar el Paso 3 (Mapeo). |
| `Error 401 / 403 de la API` | Las credenciales de la API son incorrectas o expiró el token. Actualizar en **APIs**. |
| `Error 4XX de la API` | Los datos enviados no son los que espera la API. Revisar el mapeo de campos. |
| `Error 5XX de la API` | El servidor de la API está fallando. El sistema reintentará automáticamente. |

### Reintentos automáticos

Ante errores de conexión o errores del servidor de la API, KLSyncBridge reintenta automáticamente:
- 1er reintento: 1 minuto después
- 2do reintento: 2 minutos después
- 3er reintento: 4 minutos después

Si después de todos los reintentos sigue fallando, registra el error en los logs y espera la próxima ejecución programada.

### Olvidé la contraseña del admin

**Si tenés acceso a otro usuario administrador:** Menú **Usuarios** → fila admin → **Restablecer contraseña**.

**Si no tenés acceso a la UI:** ejecutar desde el servidor (cmd como Administrador en la carpeta del proyecto):

```bat
node scripts/reset-admin.js
```

Muestra una nueva contraseña generada aleatoriamente. Entrar con ella y cambiarla inmediatamente desde **Usuarios → Cambiar contraseña**.

---

## Resumen rápido — Flujo completo desde cero

```
INSTALACIÓN (una vez, como Administrador):
  1. Copiar la carpeta del proyecto al servidor
  2. Clic derecho en instalar.bat → "Ejecutar como administrador"
  3. Anotar el usuario y contraseña que aparecen en pantalla
  4. El navegador se abre solo en http://localhost:3847

CONFIGURACIÓN:
  5. Menú Conexiones → Nueva conexión → Probar → Guardar
  6. Menú APIs       → Nueva API      → Probar → Guardar
  7. Menú Tareas     → Nueva tarea    → Wizard 4 pasos → Guardar

VERIFICACIÓN:
  8. Botón "Ejecutar ahora" → verificar en Logs que fue exitoso
  9. Si todo OK → la tarea corre sola según el horario configurado

ACCESO DIARIO:
  - Usar el acceso directo del Escritorio (creado automáticamente)
  - O abrir http://localhost:3847 en el navegador
```

> El servicio arranca solo con Windows. No hace falta abrir ninguna consola ni correr ningún comando para el uso diario.

---

## Contacto de soporte

Ante cualquier problema no resuelto con esta guía, contactar al técnico instalador con:

1. Descripción del problema y en qué pantalla ocurre
2. Captura de pantalla del mensaje de error
3. Fecha y hora aproximada del problema
4. El archivo `logs/app-YYYY-MM-DD.log` del día correspondiente
