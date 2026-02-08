const fs = require("fs");
const path = require("path");

// Path to your products.json
const productsFile = path.join(__dirname, "products.json");

// Default image path (make sure this file exists in public/images/)
const defaultImage = "/images/default.jpg";

// Read products
let products = [];
try {
  products = JSON.parse(fs.readFileSync(productsFile, "utf-8"));
} catch (err) {
  console.error("Error reading products.json:", err);
  process.exit(1);
}

// Fix missing or invalid image paths
products = products.map(p => {
  if (!p.image || typeof p.image !== "string" || !fs.existsSync(path.join(__dirname, "public", p.image))) {
    console.log(`Fixing product: ${p.name || p.id}`);
    p.image = defaultImage;
  }
  return p;
});

// Save back
fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
console.log("All products fixed ✅");
