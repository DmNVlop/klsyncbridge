# Guía de Releases y Actualización Automática (Auto-Update)

Este documento detalla el funcionamiento del sistema de actualización automática de **KLSyncBridge** y las instrucciones para realizar releases de forma segura y exitosa.

---

## ⚙️ Arquitectura del Mecanismo de Actualización

Los clientes instalados realizan peticiones a la API local de su servicio. El servicio consulta a GitHub para verificar si hay una versión disponible más reciente que la local.

```
[ Cliente Local ] ──(1. /check-update)──> [ GitHub (version.json) ]
        │
        └──(2. /update si hay versión nueva)──> [ Descarga main.zip/master.zip ] ──> [ Auto-Instalación ]
```

### ⚠️ Compatibilidad de Ramas (Master vs Main)
* **Clientes antiguos (`v1.0.0`)**: Buscan y descargan directamente desde la rama **`main`** (`version.json` y `main.zip`).
* **Clientes nuevos (`v1.1.0` en adelante)**: Buscan y descargan de la rama **`master`** (`version.json` y `master.zip`), que es la rama por defecto de desarrollo de este proyecto.

Para mantener la compatibilidad con clientes existentes y permitirles actualizarse a la nueva estructura, **el repositorio de GitHub siempre debe contar con ambas ramas sincronizadas (`master` y `main`)**.

---

## 🚀 Flujo de Trabajo para Publicar un Release

### Paso 1: Confirmar Cambios en Git
Asegúrate de confirmar todas tus modificaciones y dejar el árbol de trabajo limpio antes de ejecutar el release:
```bash
git add .
git commit -m "feat: descripción de tus cambios"
```

### Paso 2: Ejecutar el Script de Release
Ejecuta la automatización para incrementar la versión, generar el changelog y crear el tag de Git correspondiente:

```bash
# De forma interactiva (solicita datos en consola)
npm run release

# O especificando incremento y changelog directamente (ideal para CI/CD o modo rápido)
npm run release -- patch --changelog "Descripción del release aquí" --yes
```

Este script modificará automáticamente `package.json` y `version.json` con la fecha del día actual y creará un tag local (ej. `v1.1.0`).

### Paso 3: Publicar en GitHub (Crucial)
Una vez terminado el script de release, debes empujar la rama `master`, sincronizar la rama `main` y empujar los tags de versión:

```bash
# 1. Subir cambios a la rama principal (master)
git push origin master

# 2. Subir cambios a la rama 'main' (para compatibilidad de clientes v1.0.0) y empujar tags
git push origin master:main --tags
```

> [!IMPORTANT]
> El repositorio de GitHub (`DmNVlop/klsyncbridge`) debe ser **Público** para que la descarga del código ZIP por parte del instalador local (`Invoke-WebRequest`) no sea rechazada con un error 404 por falta de credenciales.
