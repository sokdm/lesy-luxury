// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");

const app = express();
const PORT = 8000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("views", path.join(__dirname, "views"));
app.engine("ejs", require("ejs").renderFile);
app.set("view engine", "ejs");

app.use(session({
  secret: "secret123",
  resave: false,
  saveUninitialized: true
}));

// Multer for admin product uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "public/images"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

// JSON helpers (always return array)
const readJSON = (file) => {
  if (!fs.existsSync(file)) return [];
  try {
    const data = fs.readFileSync(file, "utf-8");
    if (!data) return [];
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch(err) {
    console.error("Error reading JSON:", err);
    return [];
  }
};
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ===== ROUTES ===== //

// Home
app.get("/", (req, res) => res.render("index.ejs"));

// Signup/Login
app.get("/signup", (req,res)=>res.render("signup.ejs"));
app.post("/signup", async (req,res)=>{
  const {email, password} = req.body;
  const users = readJSON("users.json");
  const hashed = await bcrypt.hash(password, 10);
  users.push({email, password: hashed});
  saveJSON("users.json", users);
  res.redirect("/login");
});

app.get("/login", (req,res)=>res.render("login.ejs"));
app.post("/login", async (req,res)=>{
  const {email,password} = req.body;
  const users = readJSON("users.json");
  const user = users.find(u=>u.email===email);
  if(!user) return res.send("User not found!");
  const match = await bcrypt.compare(password,user.password);
  if(!match) return res.send("Incorrect password!");
  req.session.user = email;
  res.redirect("/dashboard");
});

// Dashboard
app.get("/dashboard", (req,res)=>{
  if(!req.session.user) return res.redirect("/");
  let products = readJSON("products.json").map(p => ({...p, price:Number(p.price)}));
  const cart = (req.session.cart || []).map(i => ({...i, price:Number(i.price), qty:Number(i.qty), id:Number(i.id)}));
  res.render("dashboard.ejs", {user:req.session.user, products, cart});
});

// Add/Increase/Decrease/Remove cart items
app.post("/cart/add", (req,res)=>{
  if(!req.session.user) return res.redirect("/");
  const {id} = req.body;
  const products = readJSON("products.json");
  const product = products.find(p => Number(p.id) === Number(id));
  if(!product) return res.send("Product not found");
  if(!req.session.cart) req.session.cart = [];
  let item = req.session.cart.find(c=>Number(c.id)===Number(id));
  if(item) item.qty++;
  else req.session.cart.push({...product, qty:1});
  res.redirect("/dashboard");
});

app.post("/cart/increase", (req,res)=>{
  if(!req.session.cart) req.session.cart = [];
  const {id} = req.body;
  let item = req.session.cart.find(c=>Number(c.id)===Number(id));
  if(item) item.qty++;
  res.redirect("/dashboard");
});

app.post("/cart/decrease", (req,res)=>{
  if(!req.session.cart) req.session.cart = [];
  const {id} = req.body;
  let item = req.session.cart.find(c=>Number(c.id)===Number(id));
  if(item){
    item.qty--;
    if(item.qty<=0){
      req.session.cart = req.session.cart.filter(c=>Number(c.id)!==Number(id));
    }
  }
  res.redirect("/dashboard");
});

// Checkout
app.get("/checkout", (req,res)=>{
  if(!req.session.user) return res.redirect("/");
  const cart = (req.session.cart||[]).map(i=>({...i, price:Number(i.price), qty:Number(i.qty)}));
  res.render("checkout.ejs",{cart});
});

app.post("/checkout", async (req,res)=>{
  const {fullName, phone, email, address, paymentMethod} = req.body;
  const cart = req.session.cart || [];
  if(cart.length===0) return res.redirect("/dashboard");

  const orders = readJSON("orders.json");
  const order = {fullName, phone, email, address, paymentMethod, cart, date:new Date()};
  orders.push(order);
  saveJSON("orders.json", orders);

  // Send confirmation email
  try{
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth:{user:'lesyluxury@gmail.com', pass:'Wisdomfx22a'}
    });
    const mailOptions = {
      from: '"Lesy Luxury" <lesyluxury@gmail.com>',
      to: email,
      subject: 'Order Confirmation - Lesy Luxury',
      html: `
        <h2>Thank you for your order, ${fullName}!</h2>
        <p>Payment Method: ${paymentMethod}</p>
        <h3>Order Summary:</h3>
        <ul>${cart.map(i=>`<li>${i.name} - $${i.price.toFixed(2)} x ${i.qty}</li>`).join('')}</ul>
        <p><strong>Total:</strong> $${cart.reduce((sum,i)=>sum+i.price*i.qty,0).toFixed(2)}</p>
        <p>Shipping to: ${address}</p>
        <p>Phone: ${phone}</p>
      `
    };
    await transporter.sendMail(mailOptions);
    console.log('Email sent to', email);
  }catch(err){console.error('Email error:', err);}

  req.session.cart=[];
  res.render("success.ejs",{fullName,email,total:cart.reduce((sum,i)=>sum+i.price*i.qty,0)});
});

// Admin
app.get("/admin", (req,res)=>res.render("admin/login.ejs"));
app.post("/admin/login",(req,res)=>{
  const {password} = req.body;
  if(password!=="admin123") return res.send("Access Denied");
  req.session.admin = true;
  res.redirect("/admin/panel");
});

app.get("/admin/panel",(req,res)=>{
  if(!req.session.admin) return res.send("Access Denied");
  const messages = readJSON("messages.json");
  res.render("admin/panel.ejs",{messages});
});

app.post("/admin/add-products", upload.array("images"), (req,res)=>{
  if(!req.session.admin) return res.send("Access Denied");
  const products = readJSON("products.json");
  let {name, price, category} = req.body;
  price = parseFloat(price);
  req.files.forEach(f=>{
    products.push({id:Date.now()+Math.random(), name, price, category, img:"/images/"+f.filename});
  });
  saveJSON("products.json", products);
  res.redirect("/admin/panel");
});

app.post("/admin/reply",(req,res)=>{
  if(!req.session.admin) return res.send("Access Denied");
  const {user, reply} = req.body;
  const messages = readJSON("messages.json");
  const msgIndex = messages.findIndex(m=>m.user===user && !m.reply);
  if(msgIndex>=0) messages[msgIndex].reply = reply;
  saveJSON("messages.json", messages);
  res.redirect("/admin/panel");
});
app.get("/admin/support", (req, res) => {
  res.render("admin-support", {
    messages: supportMessages
  });
});
// Customer messages
app.post("/message",(req,res)=>{
  if(!req.session.user) return res.redirect("/");
  const {message} = req.body;
  const messages = readJSON("messages.json");
  messages.push({user:req.session.user, message});
  saveJSON("messages.json", messages);
  res.redirect("/dashboard");
});

// Logout
app.get("/logout",(req,res)=>{req.session.destroy();res.redirect("/");});

// Start server
// Privacy Policy
app.get('/privacy-policy', (req, res) => {
  res.render('privacy-policy');
});

// Contact Support
app.get('/contact-support', (req, res) => {
  res.render('contact-support');
});

// Handle Contact Form Submission
app.post('/contact-support', (req, res) => {
  const { name, email, message } = req.body;

  // Here you can store the message in database or send email to admin
  console.log('New support message:', { name, email, message });

  // Optionally redirect to a "thank you" page or back to dashboard
  res.send('<h1>Message sent!</h1><a href="/dashboard">Back to Dashboard</a>');
});
app.listen(PORT,()=>console.log(`Server running at http://localhost:${PORT}`));
