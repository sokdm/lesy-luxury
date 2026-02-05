// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs"); // <-- bcryptjs for Termux

const app = express();
const PORT = 8000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("views", path.join(__dirname, "views"));
app.engine("ejs", require("ejs").renderFile);
app.set("view engine", "ejs");

app.use(session({
  secret: "secret123",
  resave: false,
  saveUninitialized: true
}));

// Multer setup for admin product uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "public/images"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

// JSON helpers
const readJSON = (file) => {
  if (!fs.existsSync(file)) return [];
  const data = fs.readFileSync(file, "utf-8");
  if (!data) return [];
  return JSON.parse(data);
};
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ===== Routes ===== //

// Get Started / Welcome
app.get("/", (req, res) => {
  res.render("index.ejs");
});

// Signup
app.get("/signup", (req, res) => res.render("signup.ejs"));
app.post("/signup", async (req, res) => {
  const users = readJSON("users.json");
  const { email, password } = req.body;
  if (users.find(u => u.email === email)) return res.send("User exists!");

  const hash = await bcrypt.hash(password, 10);
  users.push({ email, password: hash });
  saveJSON("users.json", users);
  req.session.user = email;
  res.redirect("/dashboard");
});

// Login
app.get("/login", (req, res) => res.render("login.ejs"));
app.post("/login", async (req, res) => {
  const users = readJSON("users.json");
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.send("User not found!");
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send("Incorrect password!");
  req.session.user = email;
  res.redirect("/dashboard");
});

// Google login placeholder
app.get("/google-login", (req, res) => {
  // Placeholder: in real app use OAuth
  req.session.user = "googleuser@gmail.com";
  res.redirect("/dashboard");
});

// Dashboard (products & cart)
app.get("/dashboard", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const products = readJSON("products.json");
  const cart = req.session.cart || [];
  res.render("dashboard.ejs", { user: req.session.user, products, cart });
});

// Add to cart
app.post("/cart/add", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const { id } = req.body;
  const products = readJSON("products.json");
  const product = products.find(p => p.id == id);
  if (!product) return res.send("Product not found");
  if (!req.session.cart) req.session.cart = [];
  req.session.cart.push(product);
  res.redirect("/dashboard");
});

// Remove from cart
app.post("/cart/remove", (req, res) => {
  const { index } = req.body;
  if (req.session.cart) req.session.cart.splice(index, 1);
  res.redirect("/dashboard");
});

// Order / Payment placeholder
app.get("/checkout", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  res.render("checkout.ejs", { cart: req.session.cart || [] });
});

app.post("/checkout", (req, res) => {
  const { name, address, paymentMethod } = req.body;
  // In real app, validate payment via API
  req.session.cart = []; // Clear cart
  res.render("success.ejs", { name, address, paymentMethod });
});

// Admin login
app.get("/admin", (req, res) => res.render("admin/login.ejs"));
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== "admin123") return res.send("Access Denied");
  req.session.admin = true;
  res.redirect("/admin/panel");
});

// Admin panel
app.get("/admin/panel", (req, res) => {
  if (!req.session.admin) return res.send("Access Denied");
  const messages = readJSON("messages.json");
  res.render("admin/panel.ejs", { messages });
});

// Admin add products
app.post("/admin/add-products", upload.array("images"), (req, res) => {
  if (!req.session.admin) return res.send("Access Denied");
  const products = readJSON("products.json");
  let { name, price, category } = req.body;
  price = parseFloat(price);
  if (price < 100 || price > 700) return res.send("Price must be 100-700");
  req.files.forEach(file => {
    products.push({
      id: Date.now() + Math.random(),
      name,
      price,
      category,
      img: "/images/" + file.filename
    });
  });
  saveJSON("products.json", products);
  res.redirect("/admin/panel");
});

// Admin reply to messages
app.post("/admin/reply", (req, res) => {
  if (!req.session.admin) return res.send("Access Denied");
  const { user, reply } = req.body;
  const messages = readJSON("messages.json");
  const msgIndex = messages.findIndex(m => m.user === user && !m.reply);
  if (msgIndex >= 0) messages[msgIndex].reply = reply;
  saveJSON("messages.json", messages);
  res.redirect("/admin/panel");
});

// Customer support
app.post("/message", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const { message } = req.body;
  const messages = readJSON("messages.json");
  messages.push({ user: req.session.user, message });
  saveJSON("messages.json", messages);
  res.redirect("/dashboard");
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});
app.post("/order", (req, res) => {
    const orders = readJSON("orders.json");
    const order = req.body; // from fetch JSON in checkout.ejs

    orders.push(order);
    saveJSON("orders.json", orders);

    // Redirect to order-success page
    res.redirect("/order-success");
});
// Start server
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
