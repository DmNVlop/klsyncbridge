# Requerimiento funcional: Exportación a archivo (CSV / JSON) en SyncBridge

## 1. Contexto

SyncBridge es un servicio de Windows que sincroniza datos desde bases de datos SQL Server hacia APIs en la nube. Actualmente, el flujo de trabajo del sistema es:

```
SQL Server (vista) → Extracción → Mapeo de campos → Envío a un ENDPOINT (API cloud)
```

Este flujo asume siempre un destino final de tipo API HTTP. Sin embargo, existen escenarios de cliente donde el destino final **no es una API**, sino un archivo que luego será:

- Cargado manualmente en un sistema en la nube que solo acepta importación de archivos (no tiene API disponible, o el cliente no tiene acceso a integrarla).
- Enviado a un tercero (contabilidad, ERP externo, distribuidor) que espera un CSV o JSON con una estructura específica.
- Usado como respaldo/auditoría de lo que se sincronizó, independientemente de si también se envía por API.

Hoy SyncBridge no contempla esta necesidad. La única salida posible es el endpoint.

## 2. Problema a resolver

Necesitamos que SyncBridge pueda tomar los datos de una vista de SQL Server, aplicar el mismo mapeo de campos que ya usa para preparar el payload del endpoint, y en lugar de (o además de) enviarlos a una API, **generarlos como archivo CSV y/o JSON en disco**.

Esto **no es un sistema nuevo**: es una extensión del mismo motor de sincronización que ya existe (conexión a SQL Server, configuración por vista, mapeo de campos, checkpoints de sincronización incremental). Lo único nuevo es el **destino final** de los datos ya extraídos y mapeados.

## 3. Alcance funcional

### 3.1 Tipos de destino (a nivel de configuración por job/vista)

Cada job de sincronización debe poder configurarse con uno de estos tres modos de destino:

| Modo | Comportamiento |
|---|---|
| **Endpoint** | Comportamiento actual: envía los datos mapeados a la API cloud configurada. |
| **Archivo** | Genera un archivo CSV y/o JSON en una ruta configurada, sin llamar a ningún endpoint. |
| **Endpoint + Archivo** | Envía a la API cloud **y** además genera el archivo, usando los mismos datos ya mapeados (una sola extracción, dos salidas). |

Esta selección debe vivir en la configuración existente de cada job/vista (la misma interfaz donde hoy se configura el mapeo de campos), no como un sistema paralelo.

### 3.2 Formatos de archivo soportados

- **CSV**: delimitador configurable (por defecto `;`, ya que trabajamos con clientes en español donde `,` es el separador decimal), codificación UTF-8 con BOM (para que Excel en español lo abra correctamente sin corromper acentos), primera fila con encabezados = nombres de campo destino (los mismos nombres que usaría el JSON del endpoint, no los nombres de columna SQL crudos).
- **JSON**: array de objetos, con los mismos nombres de campo que usa el mapeo actual hacia el endpoint. Debe ser válido y parseable (no streaming fragmentado si el archivo no lo requiere; ver nota de volumen en punto 5).

Un mismo job debe poder generar ambos formatos a la vez si así se configura (no es excluyente CSV vs JSON).

### 3.3 Nomenclatura y ubicación del archivo

- Debe poder configurarse una carpeta destino por job/cliente.
- El nombre de archivo debe incluir automáticamente: nombre de la vista/job + timestamp de generación (para no sobrescribir corridas anteriores), por ejemplo:
  `vw_Presupuestos_2026-08-04_1030.csv`
- Debe existir opción de configurar si se conserva histórico de archivos generados o si solo se mantiene el último (limpieza automática opcional).

### 3.4 Relación con la sincronización incremental existente

SyncBridge ya maneja sincronización incremental (checkpoints por vista: último ID o última fecha procesada). Esto debe respetarse igual quando el destino es archivo:

- Si el job es incremental, el archivo generado en cada corrida debe contener solo los registros nuevos/modificados desde el último checkpoint (igual que hoy se hace para el endpoint).
- Si el job es de tipo "full" (exporta todo cada vez), el archivo debe contener el dataset completo de la vista en cada corrida.

No debe crearse un mecanismo de checkpoint distinto para el modo archivo: es el mismo checkpoint que ya usa el motor, independientemente del destino final.

### 3.5 Manejo de errores

- Si el modo es "Endpoint + Archivo" y el envío al endpoint falla, debe definirse si igual se genera el archivo (recomendado: sí, ya que es independiente y sirve como respaldo) o si todo el job se marca como fallido. **Este punto debe decidirlo el equipo según cómo está diseñado hoy el manejo de errores del job.**
- Si falla la escritura del archivo (ej. sin permisos en la carpeta, disco lleno), debe quedar registrado en el log del job igual que un fallo de endpoint hoy.

## 4. Lo que NO cambia (para acotar el alcance)

- La conexión a SQL Server: se reutiliza tal cual está.
- El mapeo de campos SQL → campo destino: se reutiliza tal cual está.
- La lógica de checkpoints/incremental: se reutiliza tal cual está.
- La configuración por cliente/vista: se extiende (agregar el modo de destino y ruta de archivo), no se rediseña.

## 5. Consideraciones de volumen

Algunas vistas pueden tener volúmenes grandes de registros (se han manejado históricamente exportaciones de cientos de miles de filas en otros procesos del ecosistema). Se recomienda que la generación de archivo use escritura en streaming (no cargar todo el dataset en memoria antes de escribir), tanto para CSV como para JSON, para evitar problemas de memoria en jobs grandes o en máquinas cliente con recursos limitados.

## 6. Resultado esperado

Al finalizar la implementación, el equipo debe poder:

1. Configurar cualquier job existente (o uno nuevo) para que su destino sea **endpoint**, **archivo**, o **ambos**.
2. Si el destino incluye archivo, elegir **CSV**, **JSON**, o ambos formatos.
3. Configurar carpeta destino, delimitador CSV y política de retención de históricos.
4. Ejecutar el job (manual o programado) y obtener el archivo generado con los mismos datos y mapeo que hoy se envían al endpoint, respetando la lógica incremental existente.

## 7. Preguntas abiertas para el equipo de desarrollo

- ¿El manejo de errores debe ser independiente entre endpoint y archivo cuando ambos están activos, o debe ser todo-o-nada?
- ¿Se requiere una interfaz de usuario (UI) para configurar esto, o basta con agregarlo al archivo de configuración/wizard existente?
- ¿Se necesita notificación (log, email, UI) cuando un archivo se genera exitosamente, similar a lo que exista hoy para confirmaciones de envío a endpoint?
