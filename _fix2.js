const fs = require("fs");
let c = fs.readFileSync("server.js", "utf8");
let lines = c.split("\n");
let newLines = [];
let inRegisterMigration = false;
let inLoginMigration = false;

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  
  // Skip register handler migration (after createUser line)
  if (line.includes('user.role === "super_admin"') && 
      line.includes('user.username === "admin"') &&
      line.includes('db.updateUser(user.id, { username: "3173883093" })') &&
      newLines.length > 0 && newLines[newLines.length-1].includes('user = db.createUser')) {
    inRegisterMigration = true;
    continue;
  }
  if (inRegisterMigration) {
    if (line.includes('升级后再次检查')) continue;
    if (line.includes('user.role === "admin" && !user.is_migrated')) continue;
    if (line.includes('user.role === "super_admin" && user.username === "admin"')) continue;
    inRegisterMigration = false;
  }
  
  // Skip login handler migration
  if (line.includes('权限升级：admin')) {
    inLoginMigration = true;
    continue;
  }
  if (inLoginMigration) {
    if (line.includes('user.role === "super_admin" && user.username === "admin"') ||
        line.includes('user.role === "admin" && !user.is_migrated')) {
      continue;
    }
    inLoginMigration = false;
  }
  
  // Skip startup migration code
  if (line.includes('Migrated admin username')) {
    continue;
  }
  
  newLines.push(line);
}

fs.writeFileSync("server.js", newLines.join("\n"), "utf8");
console.log("Done. Lines:", lines.length, "->", newLines.length);
