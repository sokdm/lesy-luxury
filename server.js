const express = require("express");
const fs = require("fs");
const path = require("path");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 8000;

/* =========================
ENSURE FILES
========================= */
const ensureFile = (file, defaultData) => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
};

ensureFile("users.json", []);
ensureFile("products.json", []);
ensureFile("orders.json", []);
ensureFile("messages.json", []);
ensureFile("notifications.json", []);
ensureFile("countries.json", {
  "Nigeria": ["Lagos", "Abuja", "Port Harcourt"],
  "United States": ["New York", "Los Angeles", "Chicago"],
  "United Kingdom": ["London", "Manchester", "Birmingham"],
  "Canada": ["Toronto", "Vancouver", "Montreal"],
  "Germany": ["Berlin", "Munich", "Hamburg"],
  "France": ["Paris", "Lyon", "Marseille"],
  "Spain": ["Madrid", "Barcelona", "Seville"],
  "Italy": ["Rome", "Milan", "Naples"],
  "China": ["Beijing", "Shanghai", "Shenzhen"],
  "Japan": ["Tokyo", "Osaka", "Kyoto"]
});

/* =========================
MIDDLEWARE
========================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.set("views", path.join(__dirname, "views"));
app.engine("ejs", require("ejs").renderFile);
app.set("view engine", "ejs");

app.use(session({
  secret: process.env.SESSION_SECRET || "dev_secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === "production", maxAge: 24*60*60*1000 }
}));

/* =========================
MULTER
========================= */
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, "public/images"),
  filename: (_, file, cb) => cb(null, Date.now() + "-" + Math.random() + "-" + file.originalname)
});
const upload = multer({ storage });

/* =========================
HELPERS
========================= */
const readJSON = file => { try { return JSON.parse(fs.readFileSync(file, "utf-8")) || []; } catch { return []; } };
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const isUser = (req, res, next) => req.session.user ? next() : res.redirect("/login");
const isAdmin = (req, res, next) => req.session.admin ? next() : res.redirect("/admin");

/* =========================
ROUTES
========================= */

/* HOME */
app.get("/", (_, res) => res.render("index.ejs"));

/* AUTH */
app.get("/signup", (_, res) => res.render("signup.ejs"));
app.post("/signup", async (req, res) => {
  const users = readJSON("users.json");
  if (users.find(u => u.email === req.body.email)) return res.send("User exists");

  users.push({
    id: crypto.randomUUID(),
    email: req.body.email,
    password: await bcrypt.hash(req.body.password, 10),
    createdAt: new Date(),
    banned: false
  });
  saveJSON("users.json", users);
  res.redirect("/login");
});

app.get("/login", (_, res) => res.render("login.ejs"));
app.post("/login", async (req, res) => {
  const users = readJSON("users.json");
  const user = users.find(u => u.email === req.body.email);
  if (!user) return res.send("User not found");
  if (user.banned) return res.send("You are banned");
  if (!(await bcrypt.compare(req.body.password, user.password))) return res.send("Wrong password");

  req.session.user = { id: user.id, email: user.email };
  res.redirect("/dashboard");
});

/* DASHBOARD */
app.get("/dashboard", isUser, (req, res) => {
  const orders = readJSON("orders.json").filter(o => o && o.userId === req.session.user.id);
  const notifications = readJSON("notifications.json").filter(n => n && n.email === req.session.user.email);
  res.render("dashboard.ejs", {
    products: readJSON("products.json"),
    cart: req.session.cart || [],
    orders,
    notifications
  });
});

/* CART */
app.post("/cart/add", isUser, (req, res) => {
  const products = readJSON("products.json");
  const p = products.find(x => x.id == req.body.id);
  if (!p) return res.send("Product not found");

  req.session.cart = req.session.cart || [];
  const i = req.session.cart.find(x => x.id === p.id);
  if (i) i.qty++; else req.session.cart.push({...p, qty:1});
  res.redirect("/dashboard");
});
app.post("/cart/increase", isUser, (req, res) => {
  const item = req.session.cart?.find(x => x.id == req.body.id);
  if (item) item.qty++;
  res.redirect("/dashboard");
});
app.post("/cart/decrease", isUser, (req, res) => {
  let cart = req.session.cart || [];
  const item = cart.find(x => x.id == req.body.id);
  if (item) {
    item.qty--;
    if (item.qty <=0) cart = cart.filter(x=>x.id!=req.body.id);
  }
  req.session.cart = cart;
  res.redirect("/dashboard");
});

/* =========================
CHECKOUT WITH PALMPAY
========================= */
app.get("/checkout", isUser, (req,res)=>{
  res.render("checkout.ejs",{ cart:req.session.cart||[], countries:readJSON("countries.json") });
});

app.post("/checkout", isUser, (req,res)=>{
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect("/dashboard");

  const total = cart.reduce((a,b)=>a+b.price*b.qty,0);
  const orders = readJSON("orders.json");

  const newOrder = {
    id: crypto.randomUUID(),
    userId: req.session.user.id,
    fullName: req.body.fullName,
    email: req.body.email,
    phone: req.body.phone,
    address: req.body.address,
    country: req.body.country,
    city: req.body.city,
    items: cart,
    total,
    paymentMethod: "PalmPay",
    status: "pending",
    createdAt: new Date()
  };

  orders.push(newOrder);
  saveJSON("orders.json", orders);

  req.session.currentOrderId = newOrder.id;

  res.render("palmpay.ejs", {
    fullName: newOrder.fullName,
    total: newOrder.total,
    orderId: newOrder.id
  });
});

// AFTER USER TAP CONTINUE → SHOW PENDING
app.post("/checkout/palmpay/continue", isUser, (req,res)=>{
  const orders = readJSON("orders.json");
  const order = orders.find(o => o && o.id === req.session.currentOrderId);
  if(!order) return res.send("Order not found");

  req.session.cart = [];
  delete req.session.currentOrderId;

  res.render("pending.ejs", {
    fullName: order.fullName,
    email: order.email,
    total: order.total,
    status: order.status,
    orderId: order.id
  });
});

/* CONTACT SUPPORT */
app.get("/contact-support", isUser, (req,res)=>{
  const messages = readJSON("messages.json").filter(m=>m && m.email===req.session.user.email);
  const notifications = readJSON("notifications.json").filter(n=>n && n.email===req.session.user.email);
  res.render("support.ejs",{ messages, notifications, user:req.session.user });
});
app.post("/contact-support/send", isUser, (req,res)=>{
  const messages = readJSON("messages.json");
  messages.push({id:crypto.randomUUID(), email:req.session.user.email, sender:"user", message:req.body.message, createdAt:new Date()});
  saveJSON("messages.json", messages);
  res.redirect("/contact-support");
});

/* STATIC PAGES */
app.get("/contact", (_,res)=>res.render("contact.ejs"));
app.post("/contact", (req,res)=>{
  const messages = readJSON("messages.json");
  messages.push({ id:crypto.randomUUID(), name:req.body.name, email:req.body.email, message:req.body.message, createdAt:new Date() });
  saveJSON("messages.json", messages);
  res.send("Message sent! We'll get back to you soon.");
});
app.get("/privacy", (_,res)=>res.render("privacy.ejs"));

/* ADMIN PANEL */
app.get("/admin", (_,res)=>res.render("admin/login.ejs"));
app.post("/admin/login",(req,res)=>{
  if(req.body.password===process.env.ADMIN_PASSWORD){
    req.session.admin=true;
    res.redirect("/admin/panel");
  } else res.send("Access Denied");
});
app.get("/admin/panel", isAdmin, (req,res)=>{
  res.render("admin/panel.ejs",{
    users: readJSON("users.json"),
    products: readJSON("products.json"),
    orders: readJSON("orders.json"),
    messages: readJSON("messages.json"),
    notifications: readJSON("notifications.json")
  });
});

/* ADMIN PRODUCT */
app.post("/admin/product/upload", isAdmin, upload.single("image"), (req,res)=>{
  const products = readJSON("products.json");
  const {name, price} = req.body;
  if(!name || !price || !req.file) return res.send("All fields required");
  products.push({id:crypto.randomUUID(), name, price:parseFloat(price), image:"/images/"+req.file.filename, createdAt:new Date()});
  saveJSON("products.json", products);
  res.redirect("/admin/panel");
});
app.post("/admin/product/edit", isAdmin, (req,res)=>{
  const products = readJSON("products.json");
  const p = products.find(x=>x.id==req.body.id);
  if(p){
    p.name = req.body.name || p.name;
    p.price = req.body.price ? parseFloat(req.body.price) : p.price;
    saveJSON("products.json", products);
  }
  res.redirect("/admin/panel");
});

/* ADMIN ORDER APPROVE */
app.post("/admin/order/approve", isAdmin, (req,res)=>{
  const orders = readJSON("orders.json");
  const notifications = readJSON("notifications.json");
  const order = orders.find(o=>o && o.id==req.body.id);
  if(!order) return res.send("Order not found");

  order.status = "approved";
  saveJSON("orders.json", orders);

  notifications.push({
    id: crypto.randomUUID(),
    email: order.email,
    message: `Your order #${order.id} has been approved and is now successful.`,
    createdAt: new Date()
  });
  saveJSON("notifications.json", notifications);

  res.redirect("/admin/panel");
});

/* =========================
ADMIN DASHBOARD BUTTON ROUTES
========================= */

// Users Dashboard
app.get("/admin/users", isAdmin, (req, res) => {
  const users = readJSON("users.json");
  res.render("admin/users.ejs", { users });
});

// Products Dashboard
app.get("/admin/products", isAdmin, (req, res) => {
  const products = readJSON("products.json");
  res.render("admin/products.ejs", { products });
});

// Orders Dashboard
app.get("/admin/orders", isAdmin, (req, res) => {
  const orders = readJSON("orders.json");
  res.render("admin/orders.ejs", { orders });
});

// Messages Dashboard
app.get("/admin/messages", isAdmin, (req, res) => {
  const messages = readJSON("messages.json");
  res.render("admin/messages.ejs", { messages });
});

// Notifications Dashboard
app.get("/admin/notifications", isAdmin, (req, res) => {
  const notifications = readJSON("notifications.json");
  res.render("admin/notifications.ejs", { notifications });
});

// Logout
app.get("/admin/logout", isAdmin, (req, res) => {
  req.session.admin = false;
  res.redirect("/admin");
});

// GET edit product form
app.get("/admin/product/edit/:id", isAdmin, (req, res) => {
  const products = readJSON("products.json");
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.send("Product not found");
  res.render("admin/edit-product.ejs", { product });
});

// POST edit product
app.post("/admin/product/edit/:id", isAdmin, (req, res) => {
  const products = readJSON("products.json");
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.send("Product not found");

  product.name = req.body.name;
  product.price = parseFloat(req.body.price);
  saveJSON("products.json", products);

  res.redirect("/admin/products");
});

// POST delete product
app.post("/admin/product/delete/:id", isAdmin, (req, res) => {
  let products = readJSON("products.json");
  const exists = products.find(p => p.id === req.params.id);
  if (!exists) return res.send("Product not found");

  products = products.filter(p => p.id !== req.params.id);
  saveJSON("products.json", products);

  res.redirect("/admin/products");
});

// GET Add Product Form
app.get("/admin/product/upload", isAdmin, (req, res) => {
  res.render("admin/add-product.ejs");
});

/* START SERVER */
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
