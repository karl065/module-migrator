import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * @param {vscode.ExtensionContext} context
 */
export function activate(context) {
	console.log('¡La extensión "module-migrator" [v2.1.2] está activa!');

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
					'Por favor, abre una carpeta de proyecto en VS Code.',
				);
				return;
			}

			const rootProjectPath = workspaceFolders[0].uri.fsPath;

			const targetPath = await seleccionarDirectorioInteractivo(
				rootProjectPath,
				rootProjectPath,
				outputChannel,
			);

			if (!targetPath) return;

			const cacheArchivosProcesados = new Set();
			const cacheAnalisisDestinos = new Map();

			outputChannel.appendLine(
				`[INFO] Iniciando conversión quirúrgica en: ${targetPath}`,
			);

			try {
				await recorrerDirectorioRecursivo(
					targetPath,
					rootProjectPath,
					outputChannel,
					cacheArchivosProcesados,
					cacheAnalisisDestinos,
				);

				outputChannel.appendLine('========================================');
				outputChannel.appendLine(
					'✅ ¡Migración quirúrgica [v2.1.2] completada con éxito!',
				);
				outputChannel.appendLine('========================================');
				vscode.window.showInformationMessage(
					'¡Migración finalizada con éxito! Revisa los logs.',
				);
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				outputChannel.appendLine(`[ERROR CRÍTICO] ${errorMessage}`);
				vscode.window.showErrorMessage(`Error: ${errorMessage}`);
			}
		},
	);

	context.subscriptions.push(disposable);
}

/**
 * @param {string} dirActual
 * @param {string} rootProjectPath
 * @param {vscode.OutputChannel} outputChannel
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
			path: dirPath,
		}));

	const opciones = [
		{
			label: `🎯 [ Analizar esta carpeta: /${relativo} ]`,
			action: 'seleccionar',
			path: dirActual,
		},
		...subCarpetas.map((c) => ({ ...c, action: 'entrar' })),
	];

	const seleccion = await vscode.window.showQuickPick(opciones, {
		placeHolder: `Carpeta actual: /${relativo} — Selecciona una opción:`,
		ignoreFocusOut: true,
	});

	if (!seleccion) return undefined;
	if (seleccion.action === 'seleccionar') return seleccion.path;
	return await seleccionarDirectorioInteractivo(
		seleccion.path,
		rootProjectPath,
		outputChannel,
	);
}

/**
 * @param {string} dir
 * @param {string} rootDir
 * @param {vscode.OutputChannel} outputChannel
 * @param {Set<string>} cacheProcesados
 * @param {Map<string, any>} cacheDestinos
 */
async function recorrerDirectorioRecursivo(
	dir,
	rootDir,
	outputChannel,
	cacheProcesados,
	cacheDestinos,
) {
	if (!fs.existsSync(dir)) return;
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
					outputChannel,
					cacheProcesados,
					cacheDestinos,
				);
			}
		} else if (/\.(js|jsx|ts|tsx)$/.test(elemento)) {
			await procesarArchivoQuirurgico(
				rutaCompleta,
				rootDir,
				outputChannel,
				cacheProcesados,
				cacheDestinos,
			);
		}
	}
}

/**
 * Parser quirúrgico: Modifica únicamente líneas de importación/exportación sin tocar la lógica del archivo.
 * @param {string} filePath
 * @param {string} rootDir
 * @param {vscode.OutputChannel} outputChannel
 * @param {Set<string>} cacheProcesados
 * @param {Map<string, any>} cacheDestinos
 */
async function procesarArchivoQuirurgico(
	filePath,
	rootDir,
	outputChannel,
	cacheProcesados,
	cacheDestinos,
) {
	if (cacheProcesados.has(filePath)) return;
	cacheProcesados.add(filePath);

	if (!fs.existsSync(filePath)) return;

	let contenidoOriginal = fs.readFileSync(filePath, 'utf8');
	const currentDir = path.dirname(filePath);
	const relativoAlRoot = path.relative(rootDir, filePath);

	outputChannel.appendLine(`\n--- [v2.1.2] Procesando: ${relativoAlRoot} ---`);

	contenidoOriginal = contenidoOriginal.replace(/\u00A0/g, ' ');
	contenidoOriginal = contenidoOriginal.replace(/\r\n/g, '\n');

	// 1. Convertir exportaciones CommonJS a ESM en el archivo actual si aplica
	let contenidoModificado = contenidoOriginal;

	if (/module\.exports\s*=\s*\{[\s\S]*?\};?/.test(contenidoModificado)) {
		contenidoModificado = contenidoModificado.replace(
			/module\.exports\s*=\s*\{([\s\S]*?)\};?/g,
			/**
			 * @param {string} match
			 * @param {string} inner
			 */
			(match, inner) => {
				const cleanInner = inner.trim();
				if (!cleanInner.includes(',') && !cleanInner.includes(':')) {
					return `export default ${cleanInner};`;
				}
				return `export default {${inner}};`;
			},
		);
	} else if (/module\.exports\s*=/.test(contenidoModificado)) {
		contenidoModificado = contenidoModificado.replace(
			/module\.exports\s*=/g,
			'export default ',
		);
	} else if (
		/(?:module\.)?exports\.[a-zA-Z0-9_$]+\s*=/.test(contenidoModificado)
	) {
		contenidoModificado = contenidoModificado.replace(
			/(?:module\.)?exports\.([a-zA-Z0-9_$]+)\s*=/g,
			'export const $1 = ',
		);
	}

	/**
	 * @param {string} rawPath
	 * @param {string} rawNames
	 */
	const resolverImportacion = (rawPath, rawNames) => {
		let cleanPath = rawPath.slice(1, -1).trim();
		let cleanNames = rawNames
			.replace(/\s+/g, ' ')
			.replace(/(\.default)+/g, '')
			.trim();

		// Si es paquete externo (ej: 'express', 'fs')
		if (!cleanPath.startsWith('.') && !cleanPath.startsWith('..')) {
			return `import ${cleanNames} from '${cleanPath}';`;
		}

		// Resolver archivo físico en disco para ver su tipo de exportación
		let targetAbsolute = null;
		const possibleExtensions = ['.js', '.jsx', '.ts', '.tsx'];
		for (const ext of possibleExtensions) {
			const absoluteTarget = path.resolve(currentDir, cleanPath + ext);
			if (fs.existsSync(absoluteTarget)) {
				cleanPath += ext;
				targetAbsolute = absoluteTarget;
				break;
			}
		}

		if (!targetAbsolute || !fs.existsSync(targetAbsolute)) {
			if (!/\.(js|jsx|ts|tsx|json)$/.test(cleanPath)) cleanPath += '.js';
			return `import ${cleanNames} from '${cleanPath}';`;
		}

		// Analizar el destino usando caché
		let esExportDefaultPuro = true;
		let tieneExportsNombrados = false;

		if (cacheDestinos.has(targetAbsolute)) {
			const cached = cacheDestinos.get(targetAbsolute);
			esExportDefaultPuro = cached.esExportDefaultPuro;
			tieneExportsNombrados = cached.tieneExportsNombrados;
		} else {
			const codigoDestino = fs.readFileSync(targetAbsolute, 'utf8');
			esExportDefaultPuro =
				/export\s+default/.test(codigoDestino) ||
				/module\.exports\s*=/.test(codigoDestino);
			tieneExportsNombrados =
				/export\s+(const|function|let|var|class)/.test(codigoDestino) ||
				/exports\./.test(codigoDestino);
			cacheDestinos.set(targetAbsolute, {
				esExportDefaultPuro,
				tieneExportsNombrados,
			});
		}

		// Si el archivo destino exporta por defecto (ej: controllers), quitamos las llaves
		if (esExportDefaultPuro && !tieneExportsNombrados) {
			let innerNames = cleanNames.replace(/^\{\s*|\s*\}$/g, '').trim();
			const parts = innerNames.split(/[\s,]+/).filter(Boolean);
			cleanNames = parts.join(', ');
		} else {
			// Si son nombrados (ej: helpers de Cloudinary), aseguramos las llaves
			if (!cleanNames.startsWith('{')) {
				const parts = cleanNames.split(/[\s,]+/).filter(Boolean);
				cleanNames = `{ ${parts.join(', ')} }`;
			}
		}

		if (!/\.(js|jsx|ts|tsx|json)$/.test(cleanPath)) cleanPath += '.js';
		return `import ${cleanNames} from '${cleanPath}';`;
	};

	// 3. Procesamiento línea por línea de manera completamente segura
	const lineas = contenidoModificado.split('\n');
	let nuevasLineas = [];
	let i = 0;

	while (i < lineas.length) {
		let linea = lineas[i];
		let lineaTrim = linea.trim();

		const matchSimple = linea.match(
			/^(const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*require\s*\(\s*(['"][\s\S]*?['])\s*\)\s*;?/,
		);
		const matchSimpleDestruct = linea.match(
			/^(const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*(['"][\s\S]*?['])\s*\)\s*;?/,
		);

		if (matchSimple) {
			let varName = matchSimple[2];
			let quotePath = matchSimple[3];
			nuevasLineas.push(resolverImportacion(quotePath, varName));
			outputChannel.appendLine(`  [Convertido] ${lineaTrim}`);
			i++;
			continue;
		}

		if (matchSimpleDestruct) {
			let names = matchSimpleDestruct[2];
			let quotePath = matchSimpleDestruct[3];
			nuevasLineas.push(resolverImportacion(quotePath, `{ ${names} }`));
			outputChannel.appendLine(`  [Convertido Destructurado] ${lineaTrim}`);
			i++;
			continue;
		}

		if (/^(const|let|var)\s*\{/.test(lineaTrim) && !lineaTrim.includes('=')) {
			let bloqueBuffer = linea;
			let j = i + 1;
			let encontradoCierre = false;

			while (j < lineas.length) {
				bloqueBuffer += '\n' + lineas[j];
				if (
					/\}\s*=\s*require\s*\(/.test(lineas[j]) &&
					(lineas[j].includes(');') || lineas[j].includes(')'))
				) {
					encontradoCierre = true;
					break;
				}
				j++;
			}

			if (encontradoCierre) {
				const matchMulti = bloqueBuffer.match(
					/(const|let|var)\s*\{\s*([\s\S]*?)\s*\}\s*=\s*require\s*\(\s*(['"][\s\S]*?['])\s*\)\s*;?/,
				);
				if (matchMulti) {
					let names = matchMulti[2].replace(/\s+/g, ' ').trim();
					let quotePath = matchMulti[3];
					nuevasLineas.push(resolverImportacion(quotePath, `{ ${names} }`));
					outputChannel.appendLine(
						`  [Convertido Multilínea] De línea ${i + 1} a ${j + 1}`,
					);
					i = j + 1;
					continue;
				}
			}
		}

		nuevasLineas.push(linea);
		i++;
	}

	let contenidoFinal = nuevasLineas.join('\n');

	if (contenidoFinal.length < 10 && contenidoOriginal.length > 20) {
		outputChannel.appendLine(
			`  [⚠️ ERROR] Integridad fallida. Se aborta la escritura.`,
		);
		return;
	}

	if (contenidoFinal !== contenidoOriginal) {
		fs.writeFileSync(filePath + '.bak', contenidoOriginal, 'utf8');
		fs.writeFileSync(filePath, contenidoFinal, 'utf8');
		outputChannel.appendLine(`  ✔ Archivo actualizado limpiamente.`);
	} else {
		outputChannel.appendLine(`  - Sin cambios necesarios.`);
	}
}

export function deactivate() {}
