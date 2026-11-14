import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * @param {vscode.ExtensionContext} context
 */
export function activate(context) {
	console.log(
		'¡La extensión "module-migrator" con detección precisa de extensiones está activa!',
	);

	const outputChannel = vscode.window.createOutputChannel(
		'Module Migrator Logs',
	);

	let disposable = vscode.commands.registerCommand(
		'module-migrator.convertFiles',
		async () => {
			outputChannel.clear();
			outputChannel.show(true);

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				vscode.window.showErrorMessage(
					'Por favor, abre una carpeta de proyecto en VS Code antes de ejecutar la migración.',
				);
				return;
			}

			const rootProjectPath = workspaceFolders[0].uri.fsPath;

			// 1. Navegador interactivo de subcarpetas recursivo
			const targetPath = await seleccionarDirectorioInteractivo(
				rootProjectPath,
				rootProjectPath,
				outputChannel,
			);

			if (!targetPath) {
				outputChannel.appendLine(
					'[INFO] Proceso cancelado por el usuario en la selección de directorios.',
				);
				return;
			}

			// 2. Seleccionar el modo de ejecución
			const modoSeleccionado = await vscode.window.showQuickPick(
				[
					{
						label: '🚀 Automático Masivo',
						description:
							'Migra CommonJS a ESM, sanea dotenv y corrige imports en cadena.',
					},
					{
						label: '🛠️ Manual / Interactivo',
						description: 'Revisa, abre y aprueba archivo por archivo.',
					},
				],
				{
					placeHolder: 'Selecciona el modo de trabajo',
					ignoreFocusOut: true,
				},
			);

			if (!modoSeleccionado) {
				outputChannel.appendLine(
					'[INFO] Proceso cancelado por el usuario en la selección de modo.',
				);
				return;
			}

			const esManual = modoSeleccionado.label.includes('Manual');
			outputChannel.appendLine(
				`[INFO] Iniciando migración y saneamiento en cadena en: ${targetPath}`,
			);

			try {
				const cacheArchivosProcesados = new Set();

				await recorrerDirectorioRecursivo(
					targetPath,
					rootProjectPath,
					esManual,
					outputChannel,
					cacheArchivosProcesados,
				);

				outputChannel.appendLine('========================================');
				outputChannel.appendLine(
					'✅ ¡Migración completa, extensiones y llaves corregidas!',
				);
				outputChannel.appendLine('========================================');
				vscode.window.showInformationMessage(
					'¡Migración y corrección de imports finalizada con éxito! Revisa los logs.',
				);
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				outputChannel.appendLine(`[ERROR CRÍTICO] ${errorMessage}`);
				vscode.window.showErrorMessage(
					`Error durante el proceso: ${errorMessage}`,
				);
			}
		},
	);

	context.subscriptions.push(disposable);
}

/**
 * Navegador interactivo de carpetas
 * @param {string} dirActual
 * @param {string} rootProjectPath
 * @param {vscode.OutputChannel} outputChannel
 * @returns {Promise<string | undefined>}
 */
async function seleccionarDirectorioInteractivo(
	dirActual,
	rootProjectPath,
	outputChannel,
) {
	const relativo =
		path.relative(rootProjectPath, dirActual) || 'Raíz del Proyecto';

	const subCarpetas = fs
		.readdirSync(dirActual)
		.map((file) => path.join(dirActual, file))
		.filter((fullPath) => {
			try {
				return (
					fs.statSync(fullPath).isDirectory() &&
					!['node_modules', '.git', '.vscode', 'dist', 'build'].includes(
						path.basename(fullPath),
					)
				);
			} catch (e) {
				return false;
			}
		})
		.map((dirPath) => ({
			label: `📁 /${path.basename(dirPath)}`,
			description: `Entrar a ${path.basename(dirPath)}`,
			path: dirPath,
		}));

	const opciones = [
		{
			label: `🎯 [ Analizar esta carpeta: /${relativo} ]`,
			description: 'Selecciona este directorio para aplicar la migración aquí',
			action: 'seleccionar',
			path: dirActual,
		},
		...subCarpetas.map((c) => ({ ...c, action: 'entrar' })),
	];

	const seleccion = await vscode.window.showQuickPick(opciones, {
		placeHolder: `Ubicación actual: /${relativo} — Elige una opción o subcarpeta:`,
		ignoreFocusOut: true,
	});

	if (!seleccion) return undefined;
	if (seleccion.action === 'seleccionar') return seleccion.path;
	if (seleccion.action === 'entrar')
		return await seleccionarDirectorioInteractivo(
			seleccion.path,
			rootProjectPath,
			outputChannel,
		);

	return undefined;
}

/**
 * Recorre directorios buscando archivos de código
 * @param {string} dir
 * @param {string} rootDir
 * @param {boolean} esManual
 * @param {vscode.OutputChannel} outputChannel
 * @param {Set<string>} cacheProcesados
 */
async function recorrerDirectorioRecursivo(
	dir,
	rootDir,
	esManual,
	outputChannel,
	cacheProcesados,
) {
	if (!fs.existsSync(dir)) return;

	const rutaEnv = path.join(dir, '.env');
	if (fs.existsSync(rutaEnv)) {
		outputChannel.appendLine(
			`[ENV Detectado] Archivo .env localizado en: ${path.relative(rootDir, rutaEnv)}`,
		);
	}

	const elementos = fs.readdirSync(dir);

	for (const elemento of elementos) {
		const rutaCompleta = path.join(dir, elemento);
		const stat = fs.statSync(rutaCompleta);

		if (stat.isDirectory()) {
			if (
				!['node_modules', '.git', '.vscode', 'dist', 'build'].includes(elemento)
			) {
				await recorrerDirectorioRecursivo(
					rutaCompleta,
					rootDir,
					esManual,
					outputChannel,
					cacheProcesados,
				);
			}
		} else if (/\.(js|jsx|ts|tsx)$/.test(elemento)) {
			await procesarYSanearArchivo(
				rutaCompleta,
				rootDir,
				esManual,
				outputChannel,
				cacheProcesados,
			);
		}
	}
}

/**
 * Procesa un archivo individual: migra CommonJS, sanea dotenv y corrige llaves y extensiones reales (.js, .jsx, .ts, .tsx)
 * @param {string} filePath
 * @param {string} rootDir
 * @param {boolean} esManual
 * @param {vscode.OutputChannel} outputChannel
 * @param {Set<string>} cacheProcesados
 */
async function procesarYSanearArchivo(
	filePath,
	rootDir,
	esManual,
	outputChannel,
	cacheProcesados,
) {
	if (cacheProcesados.has(filePath)) return;
	cacheProcesados.add(filePath);

	if (!fs.existsSync(filePath)) return;

	let contenido = fs.readFileSync(filePath, 'utf8');
	const currentDir = path.dirname(filePath);
	const relativoAlRoot = path.relative(rootDir, filePath);
	let archivoModificado = false;

	outputChannel.appendLine(
		`\n--- Analizando y saneando: ${relativoAlRoot} ---`,
	);

	if (esManual) {
		const doc = await vscode.workspace.openTextDocument(filePath);
		await vscode.window.showTextDocument(doc, { preview: false });

		const respuesta = await vscode.window.showInformationMessage(
			`¿Migrar/sanear el archivo ${relativoAlRoot}?`,
			'Sí, convertir',
			'Omitir',
		);

		if (respuesta !== 'Sí, convertir') {
			outputChannel.appendLine(
				`[OMITIDO] El usuario decidió saltar: ${relativoAlRoot}`,
			);
			return;
		}
	}

	// 0. MIGRACIÓN INTELIGENTE DE DOTENV
	if (
		/require\(['"]dotenv['"]\)\.config\(\)/.test(contenido) ||
		/const\s+dotenv\s*=\s*require\(['"]dotenv['"]\)/.test(contenido)
	) {
		contenido = contenido.replace(
			/const\s+dotenv\s*=\s*require\(['"]dotenv['"]\);\s*dotenv\.config\(\);?/g,
			"import dotenv from 'dotenv';\ndotenv.config();",
		);
		contenido = contenido.replace(
			/require\(['"]dotenv['"]\)\.config\(\);?/g,
			"import dotenv from 'dotenv';\ndotenv.config();",
		);
		archivoModificado = true;
		outputChannel.appendLine(`  [Dotenv] Sintaxis migrada a ES Modules.`);
	}

	// 1. SANEAMIENTO Y CONVERSIÓN DE EXPORTACIONES
	let contenidoLimpioDestino = contenido;

	if (/module\.exports\s*=\s*\{[\s\S]*?\};?/.test(contenidoLimpioDestino)) {
		contenidoLimpioDestino = contenidoLimpioDestino.replace(
			/module\.exports\s*=\s*\{([\s\S]*?)\};?/g,
			(match, inner) => {
				const cleanInner = inner.trim();
				if (!cleanInner.includes(',') && !cleanInner.includes(':')) {
					return `export default ${cleanInner};`;
				}
				return `export default {${inner}};`;
			},
		);
		archivoModificado = true;
	}

	if (
		/export\s+default\s*\{[ \t]*([a-zA-Z0-9_$]+)[ \t]*\};?/.test(
			contenidoLimpioDestino,
		)
	) {
		contenidoLimpioDestino = contenidoLimpioDestino.replace(
			/export\s+default\s*\{[ \t]*([a-zA-Z0-9_$]+)[ \t]*\};?/g,
			'export default $1;',
		);
		archivoModificado = true;
	}

	if (/module\.exports\s*=/.test(contenidoLimpioDestino)) {
		contenidoLimpioDestino = contenidoLimpioDestino.replace(
			/module\.exports\s*=/g,
			'export default ',
		);
		archivoModificado = true;
	}

	if (/(?:module\.)?exports\.[a-zA-Z0-9_$]+\s*=/.test(contenidoLimpioDestino)) {
		contenidoLimpioDestino = contenidoLimpioDestino.replace(
			/(?:module\.)?exports\.([a-zA-Z0-9_$]+)\s*=/g,
			'export const $1 = ',
		);
		archivoModificado = true;
	}

	if (contenidoLimpioDestino !== contenido) {
		contenido = contenidoLimpioDestino;
		fs.writeFileSync(filePath, contenido, 'utf8');
	}

	// 2. FUNCIÓN DE INSPECCIÓN Y AJUSTE DE DEPENDENCIAS CON EXTENSIÓN REAL
	/**
	 * @param {string} quotePath
	 * @param {string} importedNames
	 */
	const resolverInspeccionarYAjustarImport = (quotePath, importedNames) => {
		let cleanPath = quotePath.slice(1, -1);

		if (!cleanPath.startsWith('.') && !cleanPath.startsWith('..')) {
			return `import ${importedNames} from '${cleanPath}';`;
		}

		let targetAbsolute = null;
		const possibleExtensions = ['.js', '.jsx', '.ts', '.tsx'];

		// Verificamos si ya trae una extensión válida en la ruta
		const hasValidExtension = possibleExtensions.some((ext) =>
			cleanPath.endsWith(ext),
		);

		if (hasValidExtension) {
			const absoluteTarget = path.resolve(currentDir, cleanPath);
			if (fs.existsSync(absoluteTarget)) {
				targetAbsolute = absoluteTarget;
			}
		} else {
			// Si no trae extensión, buscamos cuál de las extensiones permitidas existe físicamente en el disco
			for (const ext of possibleExtensions) {
				const absoluteTarget = path.resolve(currentDir, cleanPath + ext);
				if (fs.existsSync(absoluteTarget)) {
					cleanPath += ext; // Añade la extensión real (ej. .jsx, .ts, etc.)
					targetAbsolute = absoluteTarget;
					break;
				}
			}
		}

		if (!targetAbsolute || !fs.existsSync(targetAbsolute)) {
			outputChannel.appendLine(
				`  [⚠️ ADVERTENCIA] No se encontró el archivo: ${quotePath}`,
			);
			if (!/\.(js|jsx|ts|tsx|json)$/.test(cleanPath)) cleanPath += '.js'; // Fallback por defecto si no existe
			return `import ${importedNames} from '${cleanPath}';`;
		}

		outputChannel.appendLine(
			`  [Inspección] Verificando destino: ${cleanPath}`,
		);

		// Saneamiento recursivo del archivo destino
		sanearArchivoDirecto(targetAbsolute, outputChannel, cacheProcesados);

		const codigoDestinoLimpio = fs.readFileSync(targetAbsolute, 'utf8');

		const esExportDefaultPuro = /export\s+default/.test(codigoDestinoLimpio);
		const tieneExportsNombrados =
			/export\s+(const|function|let|var|class)/.test(codigoDestinoLimpio) ||
			/exports\./.test(codigoDestinoLimpio);

		let cleanNames = importedNames.trim();

		// CASO A: Destino es export default puro -> QUITAR LLAVES
		if (esExportDefaultPuro && !tieneExportsNombrados) {
			if (cleanNames.startsWith('{') && cleanNames.endsWith('}')) {
				cleanNames = cleanNames.slice(1, -1).trim();
				outputChannel.appendLine(
					`  [Corrección] Llaves removidas en importación de '${cleanNames}' (Destino es export default)`,
				);
			}
			archivoModificado = true;
			return `import ${cleanNames} from '${cleanPath}';`;
		}

		// CASO B: Destino tiene exports nombrados -> PONER LLAVES
		if (tieneExportsNombrados && !esExportDefaultPuro) {
			if (!cleanNames.startsWith('{')) {
				cleanNames = `{ ${cleanNames} }`;
				outputChannel.appendLine(
					`  [Corrección] Llaves agregadas en importación de '${cleanNames}' (Destino usa exports nombrados)`,
				);
			}
			archivoModificado = true;
			return `import ${cleanNames} from '${cleanPath}';`;
		}

		archivoModificado = true;
		return `import ${importedNames} from '${cleanPath}';`;
	};

	// 3. CONVERSIÓN Y CORRECCIÓN DE REQUIRES Y IMPORTS EXISTENTES

	// A. Requires desestructurados
	let nuevoContenido = contenido.replace(
		/const\s+(\{[\s\S]*?\})\s*=\s*require\((['"](\.|\.\.).*?['])\);?/g,
		(match, names, quotePath) =>
			resolverInspeccionarYAjustarImport(quotePath, names),
	);

	// B. Requires estándar
	nuevoContenido = nuevoContenido.replace(
		/const\s+([a-zA-Z0-9_$]+)\s*=\s*require\((['"](\.|\.\.).*?['])\);?/g,
		(match, varName, quotePath) =>
			resolverInspeccionarYAjustarImport(quotePath, varName),
	);

	// C. Imports ya existentes (actualiza extensión real y llaves)
	nuevoContenido = nuevoContenido.replace(
		/import\s+([\s\S]*?)\s+from\s+(['"](\.|\.\.).*?[']);?/g,
		(match, importedNames, quotePath) =>
			resolverInspeccionarYAjustarImport(quotePath, importedNames),
	);

	// 4. GUARDAR CAMBIOS
	if (archivoModificado || nuevoContenido !== contenido) {
		fs.writeFileSync(filePath, nuevoContenido, 'utf8');
		outputChannel.appendLine(
			`  ✔ Archivo actualizado con su extensión real y llaves correctas.`,
		);
	} else {
		outputChannel.appendLine(`  - Sin cambios necesarios.`);
	}
}

/**
 * Función auxiliar para sanear un archivo destino y registrarlo en caché
 * @param {string} filePath
 * @param {vscode.OutputChannel} outputChannel
 * @param {Set<string>} cacheProcesados
 */
async function sanearArchivoDirecto(filePath, outputChannel, cacheProcesados) {
	if (cacheProcesados.has(filePath)) return;
	if (!fs.existsSync(filePath)) return;

	let contenido = fs.readFileSync(filePath, 'utf8');
	let modificado = false;

	if (/module\.exports\s*=\s*\{[\s\S]*?\};?/.test(contenido)) {
		contenido = contenido.replace(
			/module\.exports\s*=\s*\{([\s\S]*?)\};?/g,
			(match, inner) => {
				const cleanInner = inner.trim();
				if (!cleanInner.includes(',') && !cleanInner.includes(':')) {
					return `export default ${cleanInner};`;
				}
				return `export default {${inner}};`;
			},
		);
		modificado = true;
	}

	if (/export\s+default\s*\{[ \t]*([a-zA-Z0-9_$]+)[ \t]*\};?/.test(contenido)) {
		contenido = contenido.replace(
			/export\s+default\s*\{[ \t]*([a-zA-Z0-9_$]+)[ \t]*\};?/g,
			'export default $1;',
		);
		modificado = true;
	}

	if (/module\.exports\s*=/.test(contenido)) {
		contenido = contenido.replace(/module\.exports\s*=/g, 'export default ');
		modificado = true;
	}

	if (modificado) {
		fs.writeFileSync(filePath, contenido, 'utf8');
		cacheProcesados.add(filePath);
		outputChannel.appendLine(
			`  [Saneamiento Recursivo] Dependencia actualizada: ${path.basename(filePath)}`,
		);
	}
}

export function deactivate() {}
