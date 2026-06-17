# KLSyncBridge — Manual de Usuario

**Versión:** 2.x  
**Aplicación:** `http://localhost:3847`

---

## Tabla de contenidos

1. [¿Qué es KLSyncBridge?](#1-qué-es-klsyncbridge)
2. [Acceso a la aplicación](#2-acceso-a-la-aplicación)
3. [Resumen del flujo de trabajo](#3-resumen-del-flujo-de-trabajo)
4. [Paso 1 — Crear una Conexión SQL Server](#4-paso-1--crear-una-conexión-sql-server)
5. [Paso 2 — Crear una Configuración de API](#5-paso-2--crear-una-configuración-de-api)
6. [Paso 3 — Crear un Job de sincronización](#6-paso-3--crear-un-job-de-sincronización)
   - [3.1 Fuente de datos](#61-fuente-de-datos)
   - [3.2 API destino](#62-api-destino)
   - [3.3 Mapeo de campos](#63-mapeo-de-campos)
   - [3.4 Programación (Schedule)](#64-programación-schedule)
7. [Ejecutar y monitorear un Job](#7-ejecutar-y-monitorear-un-job)
8. [Pantalla de Logs](#8-pantalla-de-logs)
9. [Acciones sobre un Job existente](#9-acciones-sobre-un-job-existente)
10. [Referencia: Transformaciones de campos](#10-referencia-transformaciones-de-campos)
11. [Referencia: Tipos de autenticación de API](#11-referencia-tipos-de-autenticación-de-api)
12. [Referencia: Modos de operación](#12-referencia-modos-de-operación)
13. [Referencia: Expresiones avanzadas](#13-referencia-expresiones-avanzadas)
14. [Ejemplo completo de integración](#14-ejemplo-completo-de-integración)
15. [Solución de problemas comunes](#15-solución-de-problemas-comunes)

---

## 1. ¿Qué es KLSyncBridge?

KLSyncBridge es una aplicación que lee datos de una base de datos SQL Server y los envía automáticamente a una API REST externa (por ejemplo, ArdisApp). Se ejecuta en segundo plano en el equipo y puede programarse para sincronizar de forma continua.

El flujo básico es siempre el mismo:

```
SQL Server  →  KLSyncBridge (transforma datos)  →  API REST externa
```

**Casos de uso típicos:**
- Sincronizar materiales del ERP hacia ArdisApp.
- Enviar catálogos de productos actualizados a una plataforma en la nube.
- Replicar cambios en tablas de precios hacia una API de e-commerce.

---

## 2. Acceso a la aplicación

Abrir el navegador y entrar a:

```
http://localhost:3847
```

La aplicación solo es accesible desde el mismo equipo donde está instalada. No se puede acceder desde otro ordenador de la red.

**Login:** Usar las credenciales creadas durante la instalación (por defecto, el usuario `admin`).

> El token de sesión dura **8 horas**. Pasado ese tiempo, la aplicación pedirá iniciar sesión de nuevo.

---

## 3. Resumen del flujo de trabajo

Configurar una integración requiere tres pasos en orden:

```
1. Crear Conexión        →  defines de dónde leer los datos
                            (SQL Server, CSV o Excel)
2. Crear Configuración   →  defines a qué API enviar los datos
   de API
3. Crear Job             →  defines qué tabla leer, cómo transformar
                            los datos y cuándo ejecutar
```

No se puede crear un Job sin haber creado primero la Conexión y la Configuración de API que usará.

---

## 4. Paso 1 — Crear una Conexión

**Dónde:** Menú lateral → **Conexiones**

Esta pantalla lista todas las conexiones definidas. Para crear una nueva, hacer clic en **+ Nueva conexión**.

La aplicación soporta tres tipos de origen de datos. El selector **Tipo de origen** en el formulario muestra los campos correspondientes a cada tipo.

---

### Tipo: SQL Server

Conecta directamente a una base de datos SQL Server en red.

| Campo | Descripción | Ejemplo |
|---|---|---|
| **Nombre** | Nombre descriptivo para identificar esta conexión | `ERP Principal` |
| **Host / IP** | Dirección del servidor SQL Server | `192.168.1.100` o `SERVIDOR-ERP` |
| **Puerto** | Puerto TCP de SQL Server (por defecto 1433) | `1433` |
| **Base de datos** | Nombre exacto de la base de datos | `MIEMPRESA_DB` |
| **Usuario** | Usuario SQL Server con permisos de lectura | `kl_reader` |
| **Contraseña** | Contraseña del usuario SQL | `••••••••` |
| **Cifrar conexión** | Activa TLS para la conexión (recomendado) | ✓ activado |
| **Confiar en certificado** | Deshabilita la validación del certificado TLS. Activar solo si el servidor usa certificado autofirmado | depende del entorno |

> La contraseña se almacena cifrada (AES-256-GCM). Nunca se guarda en texto plano.

**Probar la conexión:** Antes de guardar, hacer clic en **Probar conexión**. La aplicación intentará conectar al SQL Server con las credenciales introducidas y mostrará si la conexión es exitosa o el error específico.

**No guardar una conexión que no pasa la prueba.** Los Jobs que usen una conexión rota fallarán al ejecutarse.

#### Errores frecuentes al probar (SQL Server)

| Mensaje | Causa probable |
|---|---|
| `Connection timeout` | El host/IP no es alcanzable o el puerto está bloqueado por firewall |
| `Login failed for user` | Usuario o contraseña incorrectos |
| `Cannot open database` | El nombre de la base de datos no existe o el usuario no tiene acceso |
| `SSL error` | Activar "Confiar en certificado" si el servidor usa certificado autofirmado |

---

### Tipo: CSV

Lee datos desde un archivo de texto con valores separados por delimitador. El archivo debe ser accesible localmente en el servidor donde está instalado KLSyncBridge.

| Campo | Descripción | Ejemplo |
|---|---|---|
| **Nombre** | Nombre descriptivo | `Exportación ERP CSV` |
| **Ruta del archivo** | Ruta absoluta al archivo en el servidor | `C:\datos\materiales.csv` |
| **Delimitador** | Carácter que separa los campos en cada línea | `,` `;` `\t` (tabulador) |
| **Codificación** | Codificación de caracteres del archivo | `utf8` `latin1` `ascii` |
| **Tiene cabecera** | Si está activado, la primera línea del archivo se usa como nombre de las columnas. Si está desactivado, las columnas se nombran automáticamente `col_1`, `col_2`, etc. | ✓ activado (recomendado) |

> Las rutas UNC de red (`\\servidor\carpeta\archivo.csv`) no están soportadas. El archivo debe estar en una ruta local del servidor.

#### Comportamiento al cargar tablas y campos en el Job

- Al seleccionar esta conexión en el editor de Jobs y hacer clic en **Cargar**, el sistema devuelve el nombre del propio archivo como "tabla" (no hay múltiples tablas en un CSV).
- Los **campos disponibles** para el mapeo son los nombres de la primera fila (si "Tiene cabecera" está activado) o `col_1`, `col_2`, etc. (si está desactivado).
- Todos los campos se tratan como texto. Si se necesita un campo numérico en la API, usar la transformación `number` en el mapeo.

#### Consideraciones importantes para CSV

- El archivo completo se carga en memoria en cada ejecución. Para archivos muy grandes (cientos de miles de filas), esto puede ser lento.
- El modo incremental funciona, pero igualmente lee el archivo completo — no hay filtrado nativo como en SQL Server. El filtrado se aplica en el Job mediante el campo de fecha.
- El botón **Probar conexión** no está disponible en la UI para conexiones CSV, pero la conexión se verifica automáticamente en la primera ejecución del Job.

---

### Tipo: Excel

Lee datos desde un archivo Excel (`.xlsx` o `.xls`). El archivo debe ser accesible localmente en el servidor.

| Campo | Descripción | Ejemplo |
|---|---|---|
| **Nombre** | Nombre descriptivo | `Catálogo Excel` |
| **Ruta del archivo** | Ruta absoluta al archivo en el servidor | `C:\datos\catalogo.xlsx` |
| **Hoja (Sheet)** | Nombre exacto de la hoja a leer. Si se deja vacío, se usa la primera hoja del libro | `Materiales` |
| **Fila de cabecera** | Número de fila donde están los nombres de las columnas (1 = primera fila) | `1` |

> Las rutas UNC de red (`\\servidor\carpeta\archivo.xlsx`) no están soportadas.

#### Comportamiento al cargar tablas y campos en el Job

- Al seleccionar esta conexión en el editor de Jobs y hacer clic en **Cargar**, el sistema lista **todas las hojas del libro Excel**. El usuario puede elegir qué hoja procesar en ese Job concreto.
- Esto permite tener un único archivo Excel con varias hojas y un Job distinto para cada una.
- Los **campos disponibles** para el mapeo son los valores de la fila de cabecera configurada.
- Todos los campos se tratan como texto. Usar transformaciones en el mapeo si se necesitan números o fechas.

#### Fila de cabecera

El campo **Fila de cabecera** es útil cuando el Excel tiene filas de título o información antes de los datos reales:

```
Fila 1: "Informe de Materiales — Enero 2025"   ← título decorativo
Fila 2: "Id"  "Descripcion"  "Precio"           ← esta es la cabecera real
Fila 3: 1     "Panel Blanco"  150.00             ← datos
```

En este caso, configurar **Fila de cabecera = 2** para que el sistema ignore la fila 1 y tome los nombres de columna correctos.

#### Consideraciones importantes para Excel

- El archivo completo se carga en memoria en cada ejecución.
- El botón **Probar conexión** no está disponible en la UI para conexiones Excel.

---

### Comparativa de tipos de conexión

| Característica | SQL Server | CSV | Excel |
|---|---|---|---|
| Origen | Base de datos en red | Archivo local | Archivo local |
| Múltiples "tablas" | Sí (tablas y vistas) | No (un solo archivo = una tabla) | Sí (una por hoja) |
| Filtrado incremental nativo | Sí (WHERE en SQL) | No (lee todo el archivo) | No (lee todo el archivo) |
| Detección de tipos de datos | Sí (int, datetime, etc.) | No (todo texto) | No (todo texto) |
| Probar conexión en UI | Sí | No | No |
| Rutas de red (UNC) | Sí | No | No |

---

## 5. Paso 2 — Crear una Configuración de API

**Dónde:** Menú lateral → **Configuraciones de API**

Esta pantalla lista todas las APIs destino configuradas. Para crear una nueva, hacer clic en **+ Nueva configuración**.

### Campos del formulario

| Campo | Descripción | Ejemplo |
|---|---|---|
| **Nombre** | Nombre descriptivo | `API Materiales ArdisApp` |
| **URL Base** | URL raíz de la API (sin el path del endpoint) | `https://api.ardisapp.com` |
| **Endpoint Path** | Path específico del endpoint | `/v1/sync/materiales` |
| **Método HTTP** | Método de la petición | `POST` |
| **Tipo de autenticación** | Ver sección 11 | `Bearer Token` |

La URL final que se llamará es: `URL Base` + `Endpoint Path`.  
Ejemplo: `https://api.ardisapp.com` + `/v1/sync/materiales` = `https://api.ardisapp.com/v1/sync/materiales`

### Cabeceras adicionales (Headers)

Si la API requiere cabeceras específicas además de la autenticación (por ejemplo, `Content-Type` o una cabecera personalizada de cliente), se pueden añadir en el campo **Headers** en formato JSON:

```json
{
  "X-Client-Id": "mi-empresa",
  "Accept": "application/json"
}
```

> `Content-Type: application/json` se añade automáticamente. No hace falta indicarlo.

### Schema del payload (opcional)

El campo **Payload Schema** es solo informativo: permite pegar un ejemplo del JSON que espera la API. No afecta al comportamiento de la aplicación, pero sirve como referencia al configurar el mapeo de campos del Job.

### Probar la configuración de API

Hacer clic en **Probar** envía una petición vacía al endpoint para verificar que la autenticación es correcta y la URL es alcanzable.

---

## 6. Paso 3 — Crear un Job de sincronización

**Dónde:** Menú lateral → **Jobs** → **+ Nuevo job**

El editor de Jobs tiene **4 pasos** secuenciales. Hay que completar cada paso antes de poder avanzar al siguiente.

---

### 6.1 Fuente de datos

Define de dónde se leen los datos.

#### Identificación del Job

| Campo | Descripción |
|---|---|
| **Nombre del job** | Nombre que aparecerá en la lista de Jobs y en los logs. Ej: `Sync Materiales Plancha` |
| **Descripción** | Texto libre opcional para documentar el propósito |

#### Origen de datos

| Campo | Descripción |
|---|---|
| **Conexión** | Seleccionar la conexión SQL Server creada en el Paso 1 |
| **Tabla o Vista** | Hacer clic en **Cargar** para que la aplicación liste las tablas y vistas disponibles. Seleccionar la que contiene los datos a sincronizar |
| **Campo clave** | Columna que identifica unívocamente cada fila. Debe ser un valor único por registro (normalmente un ID o código). Ej: `MaterialId`, `SKU`, `Id` |

> El campo clave es imprescindible. Se usa para detectar registros nuevos, modificados y eliminados.

#### Modo de sincronización

| Opción | Comportamiento |
|---|---|
| **Incremental** | En cada ejecución, solo lee los registros modificados desde la última ejecución. Requiere un campo de fecha/hora en la tabla. Es el modo recomendado para tablas grandes. |
| **Full (completo)** | En cada ejecución, lee todos los registros de la tabla. Adecuado para tablas pequeñas o cuando no hay campo de fecha de modificación. |

Si se elige **Incremental**, aparecerá el campo **Campo de fecha**, donde hay que seleccionar la columna datetime que indica la última modificación del registro. Ejemplos típicos: `updated_at`, `FechaModificacion`, `LastModified`.

#### Tipo de ítem

Selector del tipo de entidad que se está sincronizando. Este valor se incluye automáticamente en el campo `type` de cada objeto enviado a la API.

Valores disponibles: `material`, `edge`, `handle`, `kitchenDoor`.

> Si no sabes cuál usar, consultar la documentación de la API destino para saber qué valor espera en el campo `type`.

#### Modo de operación

Controla cómo el sistema determina si un registro fue creado, modificado o eliminado.

| Modo | Descripción |
|---|---|
| **Snapshot** | El sistema mantiene una copia interna (snapshot) del estado anterior. En cada ejecución, compara los datos actuales con ese snapshot y determina automáticamente qué cambió. Es el modo estándar y funciona sin necesidad de columnas adicionales en SQL. |
| **Passthrough** | Cada fila de la consulta SQL trae en un campo específico el tipo de operación (`upsert` o `delete`). Requiere que la tabla o vista ya tenga esa lógica implementada. |

Si se elige **Passthrough**, aparece el campo **Campo de operación**, donde hay que indicar el nombre de la columna SQL que contiene el valor de la operación.

#### Opciones de rendimiento

| Campo | Descripción | Valor por defecto |
|---|---|---|
| **Registros por lote** | Cantidad de registros que se agrupan en cada petición a la API | `500` |
| **Lotes en paralelo** | Cuántos lotes se envían simultáneamente | `2` |
| **Enviar aunque no haya cambios** | Si está activado, el Job siempre hace la petición a la API aunque no haya nada nuevo. Si está desactivado, cuando no hay cambios no se hace ninguna petición. | desactivado |

Para la mayoría de integraciones, los valores por defecto son adecuados. Solo ajustar si la API tiene límites de tamaño de petición o la tabla tiene cientos de miles de filas.

---

### 6.2 API destino

Seleccionar la Configuración de API creada en el Paso 2. La pantalla muestra un preview con el método y la URL que se usará:

```
POST https://api.ardisapp.com/v1/sync/materiales
```

Verificar que es la URL correcta antes de avanzar.

---

### 6.3 Mapeo de campos

Este es el paso más importante: define cómo se transforma cada columna de SQL Server en un campo del JSON que se enviará a la API.

#### Estructura de la tabla de mapeo

Cada fila de la tabla representa un campo del JSON de salida. Las columnas son:

| Columna | Qué define |
|---|---|
| **Campo API** | Nombre del campo en el JSON resultante. Admite notación de punto para objetos anidados: `attributes.espesor` |
| **Modo** | Tipo de origen del valor (ver abajo) |
| **Campo SQL / Valor / Expresión** | Dependiendo del modo: columna SQL, valor literal o expresión JavaScript |
| **Transformación** | Función a aplicar al valor antes de incluirlo en el JSON (solo en modo Campo) |
| **Valor por defecto** | Valor que se usará si el campo SQL es NULL |

#### Tres modos de mapeo

---

**MODO CAMPO** (fondo azul)

Lee el valor directamente de una columna de SQL Server.

| Sub-campo | Descripción |
|---|---|
| **Campo SQL** | Nombre de la columna de la tabla SQL |
| **Transformación** | Función opcional (ver sección 10) |
| **Valor por defecto** | Se usa cuando la columna SQL tiene valor NULL |

Ejemplo: columna `Descripcion` → campo API `nombre`, transformación `uppercase`:

```
SQL:  Descripcion = "panel blanco 18mm"
JSON: "nombre": "PANEL BLANCO 18MM"
```

---

**MODO FIJO** (fondo verde)

Inserta siempre el mismo valor constante, independientemente de lo que haya en SQL.

Útil para campos que la API requiere pero cuyo valor siempre es igual para todos los registros de esta integración.

Ejemplo: campo API `categoria`, valor fijo `"material"`:

```json
"categoria": "material"
```

> Para enviar un número, escribir el número sin comillas: `18`.  
> Para enviar un booleano, escribir `true` o `false`.  
> Para enviar texto, escribir el texto sin comillas: `activo`.

---

**MODO EXPRESIÓN** (fondo púrpura)

Calcula el valor mediante lógica JavaScript. Todas las columnas SQL están disponibles como variables con su nombre exacto.

Hay dos sub-modos:

**Builder visual:** Para condiciones simples del tipo SI/ENTONCES/SI_NO.

```
SI:        ESPESOR >= 18
ENTONCES:  "Grueso"
SI NO:     "Fino"
```

**Expresión avanzada:** JavaScript libre con acceso a todas las columnas.

```javascript
// Ejemplos de expresiones válidas
PRECIO > 1000 ? "Premium" : "Estándar"
String(DESCRIPCION).toUpperCase().trim()
Math.round(ESPESOR * 10) / 10
ACTIVO == 1 && STOCK > 0 ? true : false
String(CATEGORIA).includes("Sheet") ? "hoja" : "panel"
```

> Las variables son sensibles a mayúsculas/minúsculas. Si la columna SQL se llama `Descripcion`, usar `Descripcion`, no `descripcion` ni `DESCRIPCION`.

---

#### Panel de Schema de API

En la parte derecha del paso 3 aparece el campo **Schema**, que muestra el JSON de ejemplo que se configuró en la API Config. Hacer clic en cualquier campo del schema lo inserta automáticamente en el campo **Campo API** de la fila activa. Útil para no cometer errores de tipeo en los nombres de campos.

#### JSON Preview

La sección **Preview del objeto** muestra un ejemplo del JSON que se generaría con los mapeos actuales. Revisar que la estructura y los nombres de campos sean los correctos antes de avanzar.

#### Filtro de filas (opcional)

Permite excluir registros de la sincronización basándose en una condición. Solo los registros que cumplan la condición serán procesados.

Funciona igual que el modo Expresión: expresión JavaScript con las columnas SQL como variables.

Ejemplos:

```javascript
// Solo materiales activos
ACTIVO == 1

// Solo filas con espesor válido y categoría "Sheet"
ESPESOR > 0 && CATEGORIA == "Sheet"

// Excluir registros marcados como obsoletos
!String(DESCRIPCION).includes("OBSOLETO")

// Precio mayor que cero y stock disponible
PRECIO > 0 && STOCK >= 0
```

> Si el filtro está desactivado (checkbox sin marcar), se procesan todas las filas de la consulta SQL.

---

### 6.4 Programación (Schedule)

Define cuándo se ejecuta el Job automáticamente.

#### Opción 1: Cada X minutos

El Job se ejecuta cada N minutos de forma continua.

| Valor | Ejecución |
|---|---|
| `15` | Cada 15 minutos |
| `30` | Cada 30 minutos |
| `60` | Cada hora |

#### Opción 2: Expresión cron

Permite programación avanzada. Formato de 5 campos: `minuto hora día-del-mes mes día-de-la-semana`.

| Expresión | Significado |
|---|---|
| `0 6 * * *` | Todos los días a las 6:00 AM |
| `0 8 * * 1-5` | Lunes a viernes a las 8:00 AM |
| `*/5 * * * *` | Cada 5 minutos |
| `0 */2 * * *` | Cada 2 horas |
| `30 22 * * *` | Todos los días a las 22:30 |

#### Activar inmediatamente

Si la casilla **Activar y programar al guardar** está marcada, el Job quedará activo y registrado en el scheduler en cuanto se guarde. Si no se marca, el Job se guardará en estado inactivo y habrá que activarlo manualmente desde la lista de Jobs.

---

## 7. Ejecutar y monitorear un Job

**Dónde:** Menú lateral → **Jobs**

### Ejecutar manualmente

Hacer clic en el botón **▶ Ejecutar** en la fila del Job. La columna de estado cambiará a `Ejecutando...` mientras el Job está en curso. Al terminar, mostrará el resultado:

| Badge | Significado |
|---|---|
| `SUCCESS` (verde) | Todos los registros se procesaron y enviaron correctamente |
| `PARTIAL` (amarillo) | Algunos registros fallaron, pero otros se enviaron correctamente |
| `ERROR` (rojo) | El Job falló completamente (error de conexión, autenticación, etc.) |

La columna **Última ejecución** muestra la fecha y hora del último intento.

### Activar/desactivar el scheduler

El interruptor en la columna **Estado** activa o desactiva la programación automática del Job. Un Job inactivo no se ejecutará por el scheduler, pero sí puede ejecutarse manualmente.

---

## 8. Pantalla de Logs

**Dónde:** Menú lateral → **Logs**

La pantalla tiene dos pestañas.

### Pestaña: Ejecuciones

Muestra el historial de cada vez que se ejecutó un Job.

| Columna | Descripción |
|---|---|
| **Job** | Nombre del Job |
| **Inicio** | Fecha y hora de inicio de la ejecución |
| **Duración** | Tiempo total que tardó |
| **Leídos** | Registros leídos de SQL Server |
| **Creados** | Registros nuevos enviados a la API |
| **Actualizados** | Registros modificados enviados a la API |
| **Eliminados** | Registros enviados como eliminados a la API |
| **Omitidos** | Registros sin cambios (no se enviaron) |
| **Fallidos** | Registros que la API rechazó con error |
| **Estado** | Resultado final: SUCCESS, PARTIAL, ERROR |
| **HTTP** | Código HTTP de respuesta de la API |

Filtros disponibles: por Job, por estado (success/error/partial), y por rango de fechas.

### Pestaña: Integraciones API

Muestra cada petición HTTP individual que se realizó. Si un Job envió 3 lotes, aparecerán 3 filas en esta pestaña.

| Columna | Descripción |
|---|---|
| **Job** | Nombre del Job |
| **API Config** | Nombre de la configuración de API usada |
| **Método** | Método HTTP (POST, PUT, etc.) |
| **URL** | URL exacta a la que se hizo la petición |
| **Fecha** | Fecha y hora de la petición |
| **ms** | Duración de la petición en milisegundos |
| **Req bytes** | Tamaño del JSON enviado |
| **Resp bytes** | Tamaño de la respuesta recibida |
| **HTTP** | Código de respuesta HTTP |
| **Outcome** | `success` o `error` |

Hacer clic en una fila expande los detalles, mostrando el **payload enviado** y la **respuesta completa de la API**. Es la herramienta principal para diagnosticar qué datos se están enviando exactamente.

---

## 9. Acciones sobre un Job existente

Desde la lista de Jobs, cada fila tiene las siguientes acciones:

| Acción | Descripción |
|---|---|
| **▶ Ejecutar** | Lanza el Job inmediatamente, sin esperar al schedule |
| **Activar / Detener** | Activa o desactiva la ejecución automática programada |
| **↺ Reset Snapshot** | Borra el snapshot interno del Job. La próxima ejecución tratará todos los registros como nuevos y los enviará como `upsert`. Útil si se sospecha que el snapshot está desincronizado o tras una limpieza de la base de datos destino. |
| **Editar** | Abre el editor de Jobs con los datos actuales para modificarlos |
| **Eliminar** | Borra el Job y todo su historial. Esta acción no se puede deshacer. |

> **Cuándo usar Reset Snapshot:** Si la API destino fue reiniciada y no tiene registros, pero el snapshot de KLSyncBridge indica que ya los tiene, el Job no enviará nada (porque cree que no hay cambios). Hacer Reset Snapshot fuerza el reenvío completo.

---

## 10. Referencia: Transformaciones de campos

Disponibles en el modo **Campo** del mapeo de campos:

| Transformación | Efecto | Ejemplo de entrada | Resultado |
|---|---|---|---|
| `none` | Sin transformación, valor tal cual | `Panel Blanco` | `Panel Blanco` |
| `uppercase` | Convierte a mayúsculas | `panel blanco` | `PANEL BLANCO` |
| `lowercase` | Convierte a minúsculas | `PANEL BLANCO` | `panel blanco` |
| `trim` | Elimina espacios al inicio y al final | `  panel  ` | `panel` |
| `number` | Convierte a número decimal | `"18.5"` | `18.5` |
| `boolean` | Convierte a booleano. `true` si el valor es `1`, `true` o `"true"` | `1` | `true` |
| `date_iso` | Convierte fecha a formato ISO 8601 | `2025-01-10 10:30:00` | `2025-01-10T10:30:00.000Z` |
| `string` | Convierte explícitamente a string | `18` (número) | `"18"` |

---

## 11. Referencia: Tipos de autenticación de API

### Sin autenticación (`none`)

No se añade ninguna cabecera de autenticación. Usar solo si la API es pública o si la autenticación se gestiona por IP.

### Bearer Token (`bearer`)

Agrega la cabecera `Authorization: Bearer <token>` en cada petición.

| Campo | Descripción |
|---|---|
| **Token** | El token de autenticación. Se almacena cifrado. |

Ejemplo de cabecera enviada:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### API Key (`api_key`)

Agrega una clave de API en una cabecera o como parámetro de URL.

| Campo | Descripción |
|---|---|
| **Nombre de la cabecera / parámetro** | Nombre del campo. Ej: `X-Api-Key`, `api_key` |
| **Ubicación** | `header` para incluirlo en las cabeceras HTTP, `query` para añadirlo a la URL |
| **Valor** | El valor de la clave. Se almacena cifrado. |

Ejemplo con `header`:
```
X-Api-Key: abc123secret
```

Ejemplo con `query`:
```
https://api.ejemplo.com/v1/sync?api_key=abc123secret
```

### HTTP Basic (`basic`)

Codifica usuario y contraseña en base64 y los envía en la cabecera `Authorization`.

| Campo | Descripción |
|---|---|
| **Usuario** | Usuario para la autenticación básica |
| **Contraseña** | Contraseña. Se almacena cifrada. |

Ejemplo de cabecera enviada:
```
Authorization: Basic dXN1YXJpbzpwYXNzd29yZA==
```

### Login dinámico (`login`)

Antes de cada ejecución, el sistema llama a un endpoint de login para obtener un token. Luego usa ese token como Bearer en las peticiones de datos.

| Campo | Descripción | Ejemplo |
|---|---|---|
| **URL de login** | Endpoint que devuelve el token | `https://api.ejemplo.com/auth/login` |
| **Método** | Método HTTP del login | `POST` |
| **Cuerpo del login** | JSON que se enviará al endpoint de login. Usar `{{username}}` y `{{password}}` como marcadores. | `{"user": "{{username}}", "pass": "{{password}}"}` |
| **Usuario** | Valor que reemplazará `{{username}}` | `mi_usuario` |
| **Contraseña** | Valor que reemplazará `{{password}}`. Se almacena cifrado. | `••••••` |
| **Ruta del token** | Path en la respuesta JSON donde está el token. Usa notación de punto. | `data.token` o `access_token` |

Ejemplo: si la API de login responde:
```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1Ni...",
    "expires_in": 3600
  }
}
```
El campo **Ruta del token** debe ser `data.token`.

> Si el token expira durante la ejecución de un Job (error 401), el sistema renovará automáticamente el token y reintentará la petición sin intervención del usuario.

---

## 12. Referencia: Modos de operación

### Modo Snapshot

El sistema mantiene en su base de datos interna un registro de todos los ítems procesados (campo clave + hash del contenido). En cada ejecución:

1. Lee los registros actuales de SQL.
2. Compara con el snapshot anterior.
3. Determina automáticamente:
   - **Creados:** registros que no estaban en el snapshot anterior.
   - **Actualizados:** registros que estaban pero cuyo contenido cambió.
   - **Eliminados:** registros que estaban en el snapshot pero ya no están en SQL.
   - **Omitidos:** registros sin ningún cambio (no se envían a la API).

Es el modo recomendado para la mayoría de los casos. No requiere ninguna columna adicional en SQL.

### Modo Passthrough

El sistema confía completamente en la información que viene de SQL. Cada fila debe tener una columna que indique la operación:

| Valor en la columna SQL | Operación enviada a API |
|---|---|
| `upsert` | Crear o actualizar el registro |
| `delete` | Eliminar el registro |

Este modo es útil cuando la lógica de cambios ya está implementada en SQL Server (por ejemplo, mediante triggers o vistas que calculan las operaciones).

---

## 13. Referencia: Expresiones avanzadas

Las expresiones se usan en dos lugares: en el **mapeo de campos** (modo Expresión) y en el **filtro de filas**.

### Variables disponibles

Todas las columnas de la consulta SQL están disponibles como variables JavaScript con el mismo nombre que tienen en SQL:

```
Columna SQL: "Descripcion"  →  Variable: Descripcion
Columna SQL: "PRECIO_VENTA" →  Variable: PRECIO_VENTA
Columna SQL: "stock_actual" →  Variable: stock_actual
```

### Sintaxis válida

```javascript
// Condicional ternario
PRECIO > 1000 ? "Premium" : "Estándar"

// Condición con AND y OR
ACTIVO == 1 && STOCK > 0 ? "disponible" : "sin_stock"

// Operaciones matemáticas
Math.round(PESO * 1000) / 1000
PRECIO * 1.21

// Manipulación de strings
String(DESCRIPCION).toUpperCase()
String(CODIGO).trim()
String(CATEGORIA).includes("Sheet") ? "hoja" : "panel"

// Comparación de strings
TIPO == "MDF" ? "tablero" : "perfil"

// Múltiples condiciones
ESPESOR >= 18 && ESPESOR <= 25 ? "mediano" : ESPESOR > 25 ? "grueso" : "fino"
```

### Lo que NO está soportado

```javascript
// NO: operadores de pertenencia a lista
TIPO IN ["MDF", "Madera"]  // incorrecto — usar || en su lugar

// NO: sentencias if/else multilínea
if (PRECIO > 100) { "caro" } else { "barato" }  // incorrecto — usar ternario

// NO: declaración de variables
let x = PRECIO * 2; x  // incorrecto — escribir directamente la expresión
```

### Alternativa correcta para listas

```javascript
// En lugar de: TIPO IN ["MDF", "Madera"]
TIPO == "MDF" || TIPO == "Madera" ? "tablero" : "otro"
```

---

## 14. Ejemplo completo de integración

Este ejemplo recorre todo el proceso para sincronizar una tabla de materiales de SQL Server hacia ArdisApp.

### Situación

- **Origen:** SQL Server con una tabla llamada `MATERIALES`.
- **Destino:** API en `https://api.ardisapp.com`, endpoint `POST /v1/sync/materiales`.
- **Autenticación:** Bearer Token.
- **Frecuencia:** Cada 30 minutos.

### Estructura de la tabla SQL

```sql
-- Columnas de la tabla MATERIALES en SQL Server
Id              INT           -- identificador único
Descripcion     NVARCHAR(200) -- nombre del material
PrecioUnitario  DECIMAL(10,2) -- precio
EspesorMM       INT           -- espesor en milímetros
Categoria       NVARCHAR(50)  -- ejemplo: "Sheet", "Edge", "Handle"
Activo          BIT           -- 1=activo, 0=inactivo
FechaModif      DATETIME      -- última modificación
```

### JSON que espera la API

```json
{
  "_op": "upsert",
  "type": "material",
  "reference": "1",
  "nombre": "PANEL BLANCO 18MM",
  "precio": 150.00,
  "espesor": 18,
  "grupo": "hoja",
  "estado": "activo"
}
```

### Paso 1: Crear la Conexión

- **Nombre:** `ERP Principal`
- **Host:** `192.168.1.50`
- **Puerto:** `1433`
- **Base de datos:** `GESTION_DB`
- **Usuario:** `lector_sync`
- **Contraseña:** `*****`
- **Cifrar conexión:** ✓
- **Confiar en certificado:** ✓ (solo si es necesario)

→ Hacer clic en **Probar conexión** → confirmar que es exitoso → **Guardar**.

### Paso 2: Crear la Configuración de API

- **Nombre:** `API Materiales ArdisApp`
- **URL Base:** `https://api.ardisapp.com`
- **Endpoint Path:** `/v1/sync/materiales`
- **Método HTTP:** `POST`
- **Tipo de autenticación:** `Bearer Token`
- **Token:** `eyJhbGciOiJIUzI1Ni...` (token proporcionado por ArdisApp)

→ **Probar** → confirmar que responde → **Guardar**.

### Paso 3: Crear el Job

**Step 1 - Fuente de datos:**
- Nombre: `Sync Materiales`
- Conexión: `ERP Principal`
- Tabla: `MATERIALES` (cargar y seleccionar)
- Campo clave: `Id`
- Modo de sincronización: `Incremental`
- Campo de fecha: `FechaModif`
- Tipo de ítem: `material`
- Modo de operación: `Snapshot`
- Enviar aunque no haya cambios: desactivado
- Lotes: 500 registros, 2 en paralelo

**Step 2 - API destino:**
- Seleccionar `API Materiales ArdisApp`

**Step 3 - Mapeo de campos:**

| Campo API | Modo | Campo SQL / Valor / Expresión | Transformación |
|---|---|---|---|
| `reference` | Campo | `Id` | `string` |
| `nombre` | Campo | `Descripcion` | `uppercase` |
| `precio` | Campo | `PrecioUnitario` | `number` |
| `espesor` | Campo | `EspesorMM` | `number` |
| `grupo` | Expresión | `CATEGORIA == "Sheet" ? "hoja" : CATEGORIA == "Edge" ? "canto" : "otro"` | — |
| `estado` | Expresión | `Activo == 1 ? "activo" : "inactivo"` | — |

**Filtro de filas:**
```javascript
EspesorMM > 0 && PrecioUnitario > 0
```
Solo se sincronizan materiales con espesor y precio válidos.

**Step 4 - Schedule:**
- Tipo: `Cada X minutos`
- Valor: `30`
- Activar inmediatamente: ✓

→ **Guardar job**

### Resultado esperado

El JSON que se envía a la API para cada material:

```json
{
  "_op": "upsert",
  "type": "material",
  "reference": "42",
  "nombre": "PANEL BLANCO 18MM",
  "precio": 150.00,
  "espesor": 18,
  "grupo": "hoja",
  "estado": "activo"
}
```

Si un material se elimina de SQL Server, el sistema enviará:

```json
{
  "_op": "delete",
  "type": "material",
  "reference": "42"
}
```

---

## 15. Solución de problemas comunes

### El Job muestra estado ERROR

1. Ir a **Logs → Ejecuciones**, hacer clic en la fila del error.
2. Revisar el mensaje de error.
3. Ir a **Logs → Integraciones API**, buscar la misma ejecución.
4. Expandir la fila para ver el payload enviado y la respuesta de la API.

Causas frecuentes:

| Síntoma | Causa | Solución |
|---|---|---|
| `Connection timeout` en SQL | Servidor SQL no alcanzable | Verificar red, firewall, que el servicio SQL Server esté activo |
| `HTTP 401` en API | Token de autenticación expirado o incorrecto | Actualizar el token en la Configuración de API |
| `HTTP 400` en API | El JSON enviado tiene campos incorrectos o tipos de datos erróneos | Revisar el mapeo de campos y los tipos de transformación |
| `HTTP 500` en API | Error interno en el servidor de la API | Contactar al administrador de la API |
| `No field maps defined` | El Job no tiene mapeos de campos | Editar el Job y completar el Step 3 (Mapeo de campos) |

### El Job dice SUCCESS pero no llega nada a la API destino

Causas posibles:

1. **No hay cambios detectados:** Si el modo de operación es Snapshot y los datos no han cambiado desde la última ejecución, el Job no envía nada. Esto es el comportamiento correcto. Si se quiere forzar el reenvío completo, hacer **Reset Snapshot**.

2. **El filtro de filas excluye todos los registros:** Revisar la expresión del filtro de filas en el mapeo. Puede que ninguna fila cumpla la condición.

3. **La tabla está vacía:** Verificar en SQL Server que la tabla tiene registros.

### La API devuelve datos `PARTIAL`

Significa que algunos registros fueron aceptados y otros rechazados por la API. En **Logs → Integraciones API**, expandir la fila para ver la respuesta completa. La API normalmente devuelve en el campo `errors` el detalle de qué registros fallaron y por qué.

### Quiero reenviar todos los datos desde cero

1. Ir a **Jobs**, hacer clic en **↺ Reset Snapshot** en el Job correspondiente.
2. Confirmar la acción.
3. Ejecutar el Job manualmente con **▶ Ejecutar**.

El Job leerá todos los registros de SQL y los enviará como `upsert` a la API, independientemente de si ya existían antes.

### El scheduler no ejecuta el Job a la hora esperada

1. Verificar que el Job tiene el interruptor de **Estado** en activo (azul).
2. Verificar que la expresión cron o el intervalo son correctos.
3. Verificar que el servicio KLSyncBridge está en ejecución (el servidor debe estar encendido para que el scheduler funcione).

> El scheduler solo funciona mientras el servidor está activo. Si el equipo se apaga o el servicio se detiene, las ejecuciones programadas que caigan en ese periodo no se recuperan.

---

*Manual generado para KLSyncBridge v2.x*
