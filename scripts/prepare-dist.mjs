// Prepara `dist/` como un paquete publicable: `npm pack ./dist` / `npm publish ./dist`.
import { copyFile, readFile, writeFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));

// Las rutas del package.json raíz apuntan a ./dist; dentro de dist son relativas a la raíz.
const strip = (value) =>
  typeof value === "string"
    ? value.replace(/^\.\/dist\//, "./")
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strip(v)]));

const { scripts, devDependencies, files, ...rest } = pkg;
const distPkg = {
  ...rest,
  main: strip(pkg.main),
  types: strip(pkg.types),
  exports: strip(pkg.exports),
};

await writeFile("dist/package.json", JSON.stringify(distPkg, null, 2) + "\n");
await copyFile("README.md", "dist/README.md");
await copyFile("LICENSE", "dist/LICENSE");
