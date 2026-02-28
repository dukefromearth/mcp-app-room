#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import fg from "fast-glob";
import { Node, Project, SyntaxKind } from "ts-morph";

const DEFAULT_CONFIG = {
  project: "./tsconfig.json",
  roots: ["src"],
  includeOnly: "^src",
  exclude: [
    "(^|/)node_modules/",
    "(^|/)(dist|build|coverage|out|\\.next|\\.turbo)(/|$)",
    "(^|/)(test|tests|__tests__|__mocks__|fixtures|e2e)(/|$)",
    "[.](spec|test)\\.[cm]?[jt]sx?$",
    "[.]d[.]ts$",
    "(^|/)generated(/|$)",
  ],
  typegraph: {
    exportedOnly: true,
    maxNodes: 300,
    maxEdges: 1000,
  },
  callgraph: {
    entrypoints: ["src/index.ts", "src/server.ts", "src/cli.ts", "src/workers/**/*.ts"],
    maxEdges: 300,
    maxDepth: 6,
    excludeNames: [],
  },
};

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function stableSort(items, keyFn) {
  return [...items].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function hashId(prefix, value) {
  return `${prefix}_${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

function readJsonFile(filePath) {
  return fs.readFile(filePath, "utf8").then((text) => JSON.parse(text));
}

function mergeConfig(userConfig) {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    roots: userConfig.roots ?? DEFAULT_CONFIG.roots,
    exclude: userConfig.exclude ?? DEFAULT_CONFIG.exclude,
    typegraph: {
      ...DEFAULT_CONFIG.typegraph,
      ...(userConfig.typegraph ?? {}),
    },
    callgraph: {
      ...DEFAULT_CONFIG.callgraph,
      ...(userConfig.callgraph ?? {}),
    },
  };
}

function regexList(patterns) {
  return patterns.map((pattern) => new RegExp(pattern));
}

function declarationSymbolKey(declaration) {
  const symbol = declaration.getSymbol();
  if (symbol) {
    return symbol.getFullyQualifiedName();
  }

  const sourcePath = normalizePath(declaration.getSourceFile().getFilePath());
  return `${sourcePath}:${declaration.getKindName()}:${declaration.getStart()}`;
}

function escapeMermaidLabel(value) {
  return value.replace(/"/g, '\\"');
}

function isCallableDeclaration(node) {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isVariableDeclaration(node)
  );
}

function collectTypeTargets(type, symbolToTypeNode, maxDepth = 2, depth = 0, visited = new Set()) {
  if (depth > maxDepth) {
    return [];
  }

  const signature = type.getText();
  if (visited.has(signature)) {
    return [];
  }
  visited.add(signature);

  const targets = [];
  const symbol = type.getSymbol() ?? type.getAliasSymbol();
  if (symbol) {
    const target = symbolToTypeNode.get(symbol.getFullyQualifiedName());
    if (target) {
      targets.push(target);
    }
  }

  for (const subType of type.getUnionTypes()) {
    targets.push(...collectTypeTargets(subType, symbolToTypeNode, maxDepth, depth + 1, visited));
  }
  for (const subType of type.getIntersectionTypes()) {
    targets.push(...collectTypeTargets(subType, symbolToTypeNode, maxDepth, depth + 1, visited));
  }
  for (const typeArg of type.getTypeArguments()) {
    targets.push(...collectTypeTargets(typeArg, symbolToTypeNode, maxDepth, depth + 1, visited));
  }

  const arrayElement = type.getArrayElementType();
  if (arrayElement) {
    targets.push(...collectTypeTargets(arrayElement, symbolToTypeNode, maxDepth, depth + 1, visited));
  }

  return uniqueBy(targets, (target) => target.id);
}

function makeNodeKey(node, toRelativePath) {
  return `${toRelativePath(node.getSourceFile().getFilePath())}:${node.getKindName()}:${node.getStart()}`;
}

function parseNameFilters(patterns) {
  return patterns.map((pattern) => new RegExp(pattern));
}

function shouldExcludeByName(name, filters) {
  return filters.some((regex) => regex.test(name));
}

async function main() {
  const outputDirArg = process.argv[2] ?? "docs/generated";
  const configPathArg = process.argv[3] ?? "tools/arch/arch.config.json";

  const repoRoot = process.cwd();
  const outputDir = path.resolve(repoRoot, outputDirArg);
  const configPath = path.resolve(repoRoot, configPathArg);

  const userConfig = await readJsonFile(configPath);
  const config = mergeConfig(userConfig);

  const includeOnlyRegex = new RegExp(config.includeOnly);
  const excludeRegexes = regexList(config.exclude);
  const callgraphNameExcludes = parseNameFilters(config.callgraph.excludeNames ?? []);

  const toRelativePath = (filePath) => normalizePath(path.relative(repoRoot, filePath));
  const inScopePath = (relativePath) =>
    includeOnlyRegex.test(relativePath) &&
    !excludeRegexes.some((regex) => regex.test(relativePath));

  const projectPath = path.resolve(repoRoot, config.project);
  const project = new Project({
    tsConfigFilePath: projectPath,
    skipLoadingLibFiles: true,
  });
  const typeChecker = project.getTypeChecker();

  const sourceFiles = stableSort(
    project
      .getSourceFiles()
      .filter((sourceFile) => inScopePath(toRelativePath(sourceFile.getFilePath()))),
    (sourceFile) => toRelativePath(sourceFile.getFilePath()),
  );

  const sourceFileByRelativePath = new Map(
    sourceFiles.map((sourceFile) => [toRelativePath(sourceFile.getFilePath()), sourceFile]),
  );

  const typeDeclarations = [];
  for (const sourceFile of sourceFiles) {
    for (const declaration of sourceFile.getClasses()) {
      if (!config.typegraph.exportedOnly || declaration.isExported()) {
        typeDeclarations.push(declaration);
      }
    }
    for (const declaration of sourceFile.getInterfaces()) {
      if (!config.typegraph.exportedOnly || declaration.isExported()) {
        typeDeclarations.push(declaration);
      }
    }
    for (const declaration of sourceFile.getTypeAliases()) {
      if (!config.typegraph.exportedOnly || declaration.isExported()) {
        typeDeclarations.push(declaration);
      }
    }
  }

  const typeNodes = [];
  const symbolToTypeNode = new Map();
  for (const declaration of stableSort(typeDeclarations, (item) => {
    const relPath = toRelativePath(item.getSourceFile().getFilePath());
    return `${relPath}:${item.getKindName()}:${item.getName() ?? ""}:${item.getStart()}`;
  })) {
    const relPath = toRelativePath(declaration.getSourceFile().getFilePath());
    const declarationName = declaration.getName() ?? `anonymous_${declaration.getStartLineNumber()}`;
    const symbolKey = declarationSymbolKey(declaration);
    if (symbolToTypeNode.has(symbolKey)) {
      continue;
    }

    const node = {
      id: hashId("type", `${relPath}:${declaration.getKindName()}:${declarationName}`),
      label: `${declarationName} @ ${relPath}`,
      symbolKey,
      declaration,
    };

    typeNodes.push(node);
    symbolToTypeNode.set(symbolKey, node);
  }

  const typeEdges = [];
  for (const fromNode of typeNodes) {
    const declaration = fromNode.declaration;
    if (Node.isClassDeclaration(declaration)) {
      const baseClass = declaration.getBaseClass();
      if (baseClass?.getSymbol()) {
        const toNode = symbolToTypeNode.get(baseClass.getSymbol().getFullyQualifiedName());
        if (toNode && toNode.id !== fromNode.id) {
          typeEdges.push({ kind: "extends", from: fromNode, to: toNode });
        }
      }

      for (const clause of declaration.getImplements()) {
        const symbol = clause.getType().getSymbol() ?? clause.getType().getAliasSymbol();
        if (!symbol) {
          continue;
        }
        const toNode = symbolToTypeNode.get(symbol.getFullyQualifiedName());
        if (toNode && toNode.id !== fromNode.id) {
          typeEdges.push({ kind: "implements", from: fromNode, to: toNode });
        }
      }

      for (const property of declaration.getProperties()) {
        for (const toNode of collectTypeTargets(property.getType(), symbolToTypeNode)) {
          if (toNode.id !== fromNode.id) {
            typeEdges.push({ kind: "composition", from: fromNode, to: toNode });
          }
        }
      }
    }

    if (Node.isInterfaceDeclaration(declaration)) {
      for (const clause of declaration.getExtends()) {
        const symbol = clause.getType().getSymbol() ?? clause.getType().getAliasSymbol();
        if (!symbol) {
          continue;
        }
        const toNode = symbolToTypeNode.get(symbol.getFullyQualifiedName());
        if (toNode && toNode.id !== fromNode.id) {
          typeEdges.push({ kind: "extends", from: fromNode, to: toNode });
        }
      }

      for (const property of declaration.getProperties()) {
        for (const toNode of collectTypeTargets(property.getType(), symbolToTypeNode)) {
          if (toNode.id !== fromNode.id) {
            typeEdges.push({ kind: "composition", from: fromNode, to: toNode });
          }
        }
      }
    }
  }

  const sortedTypeNodes = stableSort(typeNodes, (node) => `${node.label}:${node.id}`);
  const limitedTypeNodes = sortedTypeNodes.slice(0, config.typegraph.maxNodes);
  const allowedTypeNodeIds = new Set(limitedTypeNodes.map((node) => node.id));

  const sortedTypeEdges = stableSort(
    uniqueBy(
      typeEdges.filter(
        (edge) => allowedTypeNodeIds.has(edge.from.id) && allowedTypeNodeIds.has(edge.to.id),
      ),
      (edge) => `${edge.kind}:${edge.from.id}:${edge.to.id}`,
    ),
    (edge) => `${edge.kind}:${edge.from.label}:${edge.to.label}`,
  ).slice(0, config.typegraph.maxEdges);

  const typeLines = ["classDiagram", "  direction LR"];
  for (const node of limitedTypeNodes) {
    typeLines.push(`  class "${escapeMermaidLabel(node.label)}" as ${node.id}`);
  }
  for (const edge of sortedTypeEdges) {
    if (edge.kind === "extends") {
      typeLines.push(`  ${edge.to.id} <|-- ${edge.from.id}`);
    } else if (edge.kind === "implements") {
      typeLines.push(`  ${edge.to.id} <|.. ${edge.from.id}`);
    } else {
      typeLines.push(`  ${edge.from.id} --> ${edge.to.id} : has-a`);
    }
  }

  const callableRecords = [];
  for (const sourceFile of sourceFiles) {
    const relPath = toRelativePath(sourceFile.getFilePath());

    for (const declaration of sourceFile.getFunctions()) {
      const name = declaration.getName() ?? `anonymous_${declaration.getStartLineNumber()}`;
      callableRecords.push({
        id: hashId("call", `${relPath}:function:${name}:${declaration.getStart()}`),
        label: `${name} @ ${relPath}`,
        symbolKey: declarationSymbolKey(declaration),
        nodeKey: makeNodeKey(declaration, toRelativePath),
        declaration,
      });
    }

    for (const classDeclaration of sourceFile.getClasses()) {
      const className = classDeclaration.getName() ?? `AnonymousClass_${classDeclaration.getStartLineNumber()}`;
      for (const method of classDeclaration.getMethods()) {
        const methodName = `${className}.${method.getName()}`;
        callableRecords.push({
          id: hashId("call", `${relPath}:method:${methodName}:${method.getStart()}`),
          label: `${methodName} @ ${relPath}`,
          symbolKey: declarationSymbolKey(method),
          nodeKey: makeNodeKey(method, toRelativePath),
          declaration: method,
        });
      }

      for (const constructor of classDeclaration.getConstructors()) {
        const constructorName = `${className}.constructor`;
        callableRecords.push({
          id: hashId("call", `${relPath}:ctor:${constructorName}:${constructor.getStart()}`),
          label: `${constructorName} @ ${relPath}`,
          symbolKey: declarationSymbolKey(constructor),
          nodeKey: makeNodeKey(constructor, toRelativePath),
          declaration: constructor,
        });
      }
    }

    for (const variable of sourceFile.getVariableDeclarations()) {
      const initializer = variable.getInitializer();
      if (!initializer) {
        continue;
      }
      if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) {
        continue;
      }

      const name = variable.getName();
      callableRecords.push({
        id: hashId("call", `${relPath}:variable:${name}:${variable.getStart()}`),
        label: `${name} @ ${relPath}`,
        symbolKey: declarationSymbolKey(variable),
        nodeKey: makeNodeKey(variable, toRelativePath),
        declaration: variable,
      });
    }
  }

  const dedupedCallables = uniqueBy(
    stableSort(callableRecords, (record) => `${record.label}:${record.symbolKey}:${record.nodeKey}`),
    (record) => record.symbolKey,
  );

  const callableBySymbol = new Map(dedupedCallables.map((record) => [record.symbolKey, record]));
  const callableByNodeKey = new Map(dedupedCallables.map((record) => [record.nodeKey, record]));
  const callablesByFile = new Map();
  for (const callable of dedupedCallables) {
    const relPath = callable.label.split(" @ ").slice(-1)[0];
    if (!callablesByFile.has(relPath)) {
      callablesByFile.set(relPath, []);
    }
    callablesByFile.get(relPath).push(callable);
  }

  const resolveCaller = (callExpression) => {
    let current = callExpression.getParent();
    while (current) {
      if (isCallableDeclaration(current)) {
        const nodeKey = makeNodeKey(current, toRelativePath);
        const callable = callableByNodeKey.get(nodeKey);
        if (callable) {
          return callable;
        }
      }
      current = current.getParent();
    }
    return null;
  };

  const resolveCallee = (callExpression) => {
    const signature = typeChecker.getResolvedSignature(callExpression);
    if (!signature) {
      return { kind: "unresolved", label: "<dynamic/unresolved>" };
    }

    const declaration = signature.getDeclaration();
    if (!declaration) {
      return { kind: "unresolved", label: "<dynamic/unresolved>" };
    }

    const declarationPath = toRelativePath(declaration.getSourceFile().getFilePath());
    if (!inScopePath(declarationPath)) {
      return { kind: "unresolved", label: "<external/unscoped>" };
    }

    const symbol = declaration.getSymbol();
    if (symbol) {
      const callable = callableBySymbol.get(symbol.getFullyQualifiedName());
      if (callable) {
        return { kind: "resolved", callable };
      }
    }

    const nodeKey = makeNodeKey(declaration, toRelativePath);
    const directCallable = callableByNodeKey.get(nodeKey);
    if (directCallable) {
      return { kind: "resolved", callable: directCallable };
    }

    let current = declaration.getParent();
    while (current) {
      if (isCallableDeclaration(current)) {
        const currentCallable = callableByNodeKey.get(makeNodeKey(current, toRelativePath));
        if (currentCallable) {
          return { kind: "resolved", callable: currentCallable };
        }
      }
      current = current.getParent();
    }

    return { kind: "unresolved", label: "<dynamic/unresolved>" };
  };

  const entrypointFiles = stableSort(
    (
      await fg(config.callgraph.entrypoints, {
        cwd: repoRoot,
        onlyFiles: true,
        unique: true,
        dot: false,
      })
    )
      .map(normalizePath)
      .filter((entrypointPath) => inScopePath(entrypointPath) && sourceFileByRelativePath.has(entrypointPath)),
    (entrypointPath) => entrypointPath,
  );

  const callgraphNodes = new Map();
  const callgraphEdges = [];
  const unresolvedNodeByLabel = new Map();

  const ensureNode = (node) => {
    callgraphNodes.set(node.id, node);
    return node;
  };

  const ensureUnresolvedNode = (label) => {
    let node = unresolvedNodeByLabel.get(label);
    if (!node) {
      node = {
        id: hashId("call", label),
        label,
      };
      unresolvedNodeByLabel.set(label, node);
      callgraphNodes.set(node.id, node);
    }
    return node;
  };

  const addCallEdge = (fromNode, toNode) => {
    if (callgraphEdges.length >= config.callgraph.maxEdges) {
      return false;
    }
    callgraphEdges.push({ from: fromNode, to: toNode });
    return true;
  };

  const queue = [];
  const queued = new Set();
  const visited = new Set();

  for (const entrypointPath of entrypointFiles) {
    const entryNode = ensureNode({
      id: hashId("entry", entrypointPath),
      label: `entry:${entrypointPath}`,
    });

    const sourceFile = sourceFileByRelativePath.get(entrypointPath);
    if (!sourceFile) {
      continue;
    }

    for (const callExpression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (resolveCaller(callExpression)) {
        continue;
      }

      const callee = resolveCallee(callExpression);
      if (callee.kind === "resolved") {
        if (
          !shouldExcludeByName(callee.callable.label, callgraphNameExcludes) &&
          addCallEdge(entryNode, ensureNode(callee.callable))
        ) {
          if (!queued.has(callee.callable.id)) {
            queue.push({ callable: callee.callable, depth: 1 });
            queued.add(callee.callable.id);
          }
        }
      } else if (addCallEdge(entryNode, ensureUnresolvedNode(callee.label))) {
      }
    }

    for (const callable of callablesByFile.get(entrypointPath) ?? []) {
      if (queued.has(callable.id)) {
        continue;
      }
      queue.push({ callable, depth: 1 });
      queued.add(callable.id);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (visited.has(current.callable.id)) {
      continue;
    }
    if (current.depth > config.callgraph.maxDepth) {
      continue;
    }
    visited.add(current.callable.id);
    ensureNode(current.callable);

    let traversalRoot = current.callable.declaration;
    if (Node.isVariableDeclaration(traversalRoot)) {
      const initializer = traversalRoot.getInitializer();
      if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
        traversalRoot = initializer;
      }
    }

    for (const callExpression of traversalRoot.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const caller = resolveCaller(callExpression);
      if (!caller || caller.id !== current.callable.id) {
        continue;
      }

      const callee = resolveCallee(callExpression);
      if (callee.kind === "resolved") {
        if (
          shouldExcludeByName(caller.label, callgraphNameExcludes) ||
          shouldExcludeByName(callee.callable.label, callgraphNameExcludes)
        ) {
          continue;
        }

        if (!addCallEdge(ensureNode(caller), ensureNode(callee.callable))) {
          break;
        }

        if (!visited.has(callee.callable.id) && !queued.has(callee.callable.id)) {
          queue.push({ callable: callee.callable, depth: current.depth + 1 });
          queued.add(callee.callable.id);
        }
      } else {
        if (!addCallEdge(ensureNode(caller), ensureUnresolvedNode(callee.label))) {
          break;
        }
      }
    }
  }

  const dedupedCallEdges = stableSort(
    uniqueBy(callgraphEdges, (edge) => `${edge.from.id}:${edge.to.id}`),
    (edge) => `${edge.from.label}:${edge.to.label}`,
  );

  const callgraphTxtLines = dedupedCallEdges.map((edge) => `${edge.from.label} -> ${edge.to.label}`);
  const callgraphMermaidLines = ["flowchart LR"];
  for (const node of stableSort([...callgraphNodes.values()], (entry) => entry.label)) {
    callgraphMermaidLines.push(`  ${node.id}["${escapeMermaidLabel(node.label)}"]`);
  }
  for (const edge of dedupedCallEdges) {
    callgraphMermaidLines.push(`  ${edge.from.id} --> ${edge.to.id}`);
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "types.mmd"), `${typeLines.join("\n")}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "callgraph-app.txt"), `${callgraphTxtLines.join("\n")}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "callgraph.mmd"), `${callgraphMermaidLines.join("\n")}\n`, "utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
