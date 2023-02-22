const fs = require('fs-extra');
const nodePath = require('path');
const { transformSync, NodePath } = require('@babel/core');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const generator = require('@babel/generator').default;

const parseEntry = (path, {
  usedIdentifiers=new Set(),
  outDir=__dirname
}) => {
  const pathDir = nodePath.dirname(path)
  // 分析入口文件
  /**
   *  babel 默认解析器的 sourceType 为 script，如果代码中使用了 import 和 export 语句
   * 需要将 parser.parse 的第二个参数设置为 { sourceType: 'module' }
   */
  const ast = parser.parse(fs.readFileSync(path, 'utf-8'), { sourceType: 'module' })
  const dependencies = getDependencies(ast, pathDir)

  const {importSpecifiers, importSpecifiersMap} = getImportSpecifier(ast)
  const allIdentifiers = getAllIdentifiers(ast)

  const exportIdentifiers = getExportIdentifiers(ast)
  const variableDeclarations = getVariableDeclarations(ast)
  const functionDeclarations = getFunctionDeclarations(ast)

  const newAllIdentifiers = [...allIdentifiers]
  for (let i=0; i<importSpecifiers.length; i++) {
    const cur = importSpecifiers[i]
    const index = newAllIdentifiers.indexOf(cur)
    if(index > -1) {
      newAllIdentifiers.splice(index, 1)
    }
  }
  /**
   * 引入且已使用的变量
   */
  const usedImportVars = newAllIdentifiers
    .filter(name => importSpecifiers.includes(name))
    .map(name => importSpecifiersMap[name])

  if (dependencies.size) {
    for (const path of dependencies) {
      parseEntry(path,  {
        usedIdentifiers: new Set(usedImportVars),
        outDir
      })
    }
  }

  if (usedIdentifiers.size) {
    removeUnused(ast, {
      usedIdentifiers,
      exportIdentifiers,
    })
  }

  // 代码生成
  const { code } = generator(ast);
  const fileName = nodePath.basename(path)
  const emitFile = nodePath.resolve(outDir, fileName)
  fs.outputFile(emitFile, code)
  // 输出结果
  // console.log(code);
}

/**
 * 收集所有依赖模块的路径
 */
const getDependencies = (ast, pathDir) => {
  const dependencies = new Set();

  traverse(ast, {
    ImportDeclaration(path) {
      const dependencyPath = nodePath.resolve(pathDir, path.node.source.value);
      dependencies.add(dependencyPath);
    }
  })

  return dependencies
}

/**
 * 获取导入指定的的变量名
 */
const getImportSpecifier = (ast) => {
  const importSpecifiers = []
  const importSpecifiersMap = {}
  traverse(ast, {
    ImportSpecifier(path) {
      const localName = path.node.local.name;
      const importedName = path.node.imported.name;
      importSpecifiers.push(localName, importedName)
      importSpecifiersMap[localName]=importedName
    },
  });

  return {
    importSpecifiers,
    importSpecifiersMap
  }
}

/**
 * 收集所有导出符号
 */
const getExportIdentifiers = (ast) => {
  const exportIdentifiers = new Set();

  traverse(ast, {
    ExportNamedDeclaration(path) {
      if (path.node.declaration) {
        // 处理导出声明语句
        if (t.isVariableDeclaration(path.node.declaration)) {
          path.node.declaration.declarations.forEach((declarator) => {
            exportIdentifiers.add(declarator.id.name);
          });
        } else if (t.isFunctionDeclaration(path.node.declaration)) {
          exportIdentifiers.add(path.node.declaration.id.name);
        } else {
          exportIdentifiers.add(path.node.declaration.name);
        }
      } else {
        // 处理导出引用语句
        path.node.specifiers.forEach((specifier) => {
          exportIdentifiers.add(specifier.exported.name);
        });
      }
    },
  });

  return exportIdentifiers
}

/**
 * 收集所有变量声明节点
 */
const getVariableDeclarations = (ast) => {
  const variableDeclarations = new Set();

  traverse(ast, {
    VariableDeclaration(path) {
      const variableDeclaration = path.node.declarations.map(node => node.id.name);
      variableDeclarations.add(...variableDeclaration);
    },
  });

  return variableDeclarations
}

/**
 * 收集所有函数声明节点
 */
const getFunctionDeclarations = (ast) => {
  const functionDeclarations = new Set();

  traverse(ast, {
    FunctionDeclaration(path) {
      const functionDeclaration = path.node.id.name
      functionDeclarations.add(functionDeclaration);
    },
  });

  return functionDeclarations
}


/**
 * 收集所有变量声明符号
 */
const getAllIdentifiers = (ast) => {
  const allIdentifiers = [];

  traverse(ast, {
    Identifier(path) {
      allIdentifiers.push(path.node.name);
    },
  });

  return allIdentifiers
}

/**
 * 删除未被使用的导出符号
 */
const removeUnused = (ast, {exportIdentifiers, usedIdentifiers}) => {
  traverse(ast, {
    ExportNamedDeclaration(path) {
      if (path.node.declaration) {
        if (t.isVariableDeclaration(path.node.declaration)) {
          const declarations = path.node.declaration.declarations.filter((declarator) => {
            return exportIdentifiers.has(declarator.id.name) || usedIdentifiers.has(declarator.id.name);
          });
          if (declarations.length === 0) {
            path.remove();
          } else if (declarations.length < path.node.declaration.declarations.length) {
            path.replaceWith(t.exportNamedDeclaration(t.variableDeclaration(path.node.declaration.kind, declarations), path.node.specifiers));
          }
        } else if (t.isFunctionDeclaration(path.node.declaration)) {
          if (!usedIdentifiers.has(path.node.declaration.id.name)) {
            path.remove();
          }
        } else {
          if (!exportIdentifiers.has(path.node.declaration.name) && !usedIdentifiers.has(path.node.declaration.name)) {            
            path.remove();
          }
        }
      } else {
        const specifiers = path.node.specifiers.filter((specifier) => {
          return exportIdentifiers.has(specifier.exported.name) || usedIdentifiers.has(specifier.exported.name);
        });
        if (specifiers.length === 0) {
          path.remove();
        } else if (specifiers.length < path.node.specifiers.length) {
          path.replaceWith(t.exportNamedDeclaration(null, specifiers));
        }
      }
    },
    VariableDeclaration(path) {
      const declarations = path.node.declarations.filter((declarator) => {
        return usedIdentifiers.has(declarator.id.name);
      });

      if (declarations.length === 0) {
        path.remove();
      } else if (declarations.length < path.node.declarations.length) {
        path.replaceWith(t.variableDeclaration(path.node.kind, declarations));
      }
    },
    FunctionDeclaration(path) {
      const functionDeclaration = path.node.id.name
      if (!usedIdentifiers.has(functionDeclaration)) {
        path.remove()
      }
    },
  });
}


// 入口文件路径
const entryFilePath = nodePath.resolve(__dirname, '../src/index.js');
const outDir = nodePath.resolve(__dirname, '../lib')
const parseIndex = parseEntry(entryFilePath, {
  outDir,
})