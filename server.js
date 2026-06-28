require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");

const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
const PORT = 3000;

const supabaseUrl = process.env.SUPABASE_URL || "https://brpblkvthpdfbjqckqbk.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const hasValidServiceRole = SERVICE_ROLE_KEY.length > 20 && !SERVICE_ROLE_KEY.includes("PASTE_YOUR");
const supabaseServiceRole = hasValidServiceRole
  ? createClient(supabaseUrl, SERVICE_ROLE_KEY)
  : null;

if (!hasValidServiceRole) {
  console.warn("[SERVER] No valid SUPABASE_SERVICE_ROLE_KEY set. Admin DB ops may fail for RLS-protected tables.");
}

const adminDb = supabaseServiceRole || supabase;

const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing authorization token" });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid or expired token" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  req.user = user;
  req.profile = profile;
  next();
}

async function requireAdmin(req, res, next) {
  if (req.profile?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

/* ============ AUTH ============ */

app.post("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: req.user, profile: req.profile });
});

/* ============ ORDERS ============ */

app.get("/api/orders", authenticate, async (req, res) => {
  try {
    let query = supabase.from("boat_orders").select("*").order("createdAt", { ascending: false });

    if (req.profile.role !== "admin") {
      query = query.eq("userId", req.user.id);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders", authenticate, async (req, res) => {
  try {
    const body = { ...req.body, userId: req.user.id };

    if (!body.orderId || !body.boatName) {
      return res.status(400).json({ error: "Missing required fields: orderId, boatName" });
    }

    const { data, error } = await supabase.from("boat_orders").insert(body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/orders/:orderId", authenticate, async (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = req.body;

    const { data: existing } = await supabase
      .from("boat_orders")
      .select("*")
      .eq("orderId", orderId)
      .single();

    if (!existing) return res.status(404).json({ error: "Order not found" });

    if (req.profile.role !== "admin" && existing.userId !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to update this order" });
    }

    const { data, error } = await supabase
      .from("boat_orders")
      .update({ ...updates, updatedAt: new Date().toISOString() })
      .eq("orderId", orderId)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/orders/:orderId", authenticate, requireAdmin, async (req, res) => {
  try {
    const { error } = await adminDb
      .from("boat_orders")
      .delete()
      .eq("orderId", req.params.orderId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ PAYMENTS ============ */

app.get("/api/payments", authenticate, async (req, res) => {
  try {
    let query = supabase.from("dashboard_payments").select("*").order("createdAt", { ascending: false });

    if (req.profile.role !== "admin") {
      query = query.eq("userId", req.user.id);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/payments", authenticate, async (req, res) => {
  try {
    const body = { ...req.body, userId: req.user.id };

    if (!body.orderId || !body.amount) {
      return res.status(400).json({ error: "Missing required fields: orderId, amount" });
    }

    const { data: order } = await supabase
      .from("boat_orders")
      .select("orderId")
      .eq("orderId", body.orderId)
      .single();

    if (!order) {
      return res.status(400).json({ error: "Order not found. Cannot submit payment for a non-existent order." });
    }

    const { data, error } = await supabase.from("dashboard_payments").insert(body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/payments/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("dashboard_payments")
      .update({ ...req.body, updatedAt: new Date().toISOString() })
      .eq("id", req.params.id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ PROFILES ============ */

app.get("/api/profiles", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/profiles/:id", authenticate, async (req, res) => {
  try {
    if (req.profile.role !== "admin" && req.params.id !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { data, error } = await supabase
      .from("profiles")
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ INVENTORY ============ */

app.get("/api/inventory", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("inventory").select("*").order("createdAt", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/inventory", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("inventory").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/inventory/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("inventory")
      .update({ ...req.body, updatedAt: new Date().toISOString() })
      .eq("id", req.params.id)
      .select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/inventory/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { error } = await adminDb.from("inventory").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ WORKERS ============ */

app.get("/api/workers", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase.from("project_workers").select("*").order("createdAt", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/workers", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("project_workers").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/workers/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { error } = await adminDb.from("project_workers").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ TASKS ============ */

app.get("/api/tasks", authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase.from("project_tasks").select("*").order("createdAt", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb.from("project_tasks").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await adminDb
      .from("project_tasks")
      .update({ ...req.body, updatedAt: new Date().toISOString() })
      .eq("id", req.params.id)
      .select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/tasks/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { error } = await adminDb.from("project_tasks").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ DOCUMENT UPLOAD ============ */

app.post("/api/upload", authenticate, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const fileUrl = "/uploads/" + req.file.filename;
    res.json({ url: fileUrl, filename: req.file.originalname, size: req.file.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ REPORTS ============ */

app.get("/api/reports/summary", authenticate, requireAdmin, async (req, res) => {
  try {
    const { data: orders, error } = await adminDb.from("boat_orders").select("*");
    if (error) return res.status(500).json({ error: error.message });

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((s, o) => s + (parseInt(String(o.boatPrice || '0').replace(/[^0-9]/g, '')) || 0), 0);
    const completed = orders.filter(o => o.status === 'Completed').length;
    const pending = orders.filter(o => o.status === 'Pending' || o.status === 'Pending Signing').length;
    const active = orders.filter(o => o.status === 'Approved').length;

    const boatCount = {};
    orders.forEach(o => {
      const name = o.boatName || 'Unknown';
      boatCount[name] = (boatCount[name] || 0) + 1;
    });

    res.json({
      totalOrders,
      totalRevenue,
      completed,
      pending,
      active,
      topBoats: Object.entries(boatCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ EMAIL UTILITY ============ */

const EMAIL_FROM = `"Infinity Boat Works" <${process.env.EMAIL_USER || "infiboatworks@gmail.com"}>`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "infinityboatsystem@gmail.com";

const EMAIL_TEMPLATES = {
  order_created: (data) => ({
    subject: `Order Confirmed — ${data.orderId}`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">Order Confirmed 🚢</h2>
        <p>Hi <strong>${escHtml(data.customerName || "Valued Customer")}</strong>,</p>
        <p>Thank you for placing your order with Infinity Boat Works! Your order has been received and is now being processed.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Boat Model</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Price</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatPrice || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Payment</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.paymentMethod || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Status</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.status || "Pending")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Date</strong></td><td style="padding:8px;border:1px solid #ddd">${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</td></tr>
        </table>
        <p><strong>Next Step:</strong> ${data.buildType === "custom" ? "Our engineering team will review your custom design. We'll notify you once it's approved." : "Please check your account to sign the contract schedule and proceed with the down payment."}</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),

  status_changed: (data) => ({
    subject: `Order Update — ${data.orderId} (${data.status})`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">Order Status Update 🔔</h2>
        <p>Hi <strong>${escHtml(data.customerName || "Valued Customer")}</strong>,</p>
        <p>Your order status has been updated:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Boat Model</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>New Status</strong></td><td style="padding:8px;border:1px solid #ddd"><span style="color:${getStatusColor(data.status)};font-weight:bold">${escHtml(data.status)}</span></td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Phase</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderPhase || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Progress</strong></td><td style="padding:8px;border:1px solid #ddd">${data.progress || 0}%</td></tr>
        </table>
        ${data.reviewFeedback ? `<p><strong>Feedback:</strong> ${escHtml(data.reviewFeedback)}</p>` : ""}
        <p>Log in to your account to view the full details.</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),

  payment_submitted: (data) => ({
    subject: `New Payment — ${data.customerName || "Customer"} (${data.amount})`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">New Payment Submitted 💳</h2>
        <p>A payment has been submitted and is pending review.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Customer</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.customerName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Boat</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.boatName || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #ddd">₱${Number(data.amount || 0).toLocaleString()}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Bank</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.bank || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Reference</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.reference || "—")}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Phase</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.phase || "—")}</td></tr>
        </table>
        <p>Please review and approve/reject this payment in the dashboard.</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),

  payment_approved: (data) => ({
    subject: `Payment Approved — ${data.orderId}`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">Payment Approved ✅</h2>
        <p>Hi <strong>${escHtml(data.customerName || "Valued Customer")}</strong>,</p>
        <p>Your payment has been approved!</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #ddd">₱${Number(data.amount || 0).toLocaleString()}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Phase</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.phase || "—")}</td></tr>
        </table>
        <p>Thank you for your payment!</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),

  payment_rejected: (data) => ({
    subject: `Payment Rejected — ${data.orderId}`,
    html: `
      <div style="font-family:Arial;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px">
        <h2 style="color:#1e3a5f;">Payment Rejected ❌</h2>
        <p>Hi <strong>${escHtml(data.customerName || "Valued Customer")}</strong>,</p>
        <p>Unfortunately, your payment has been rejected.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Order ID</strong></td><td style="padding:8px;border:1px solid #ddd">${escHtml(data.orderId)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;background:#f8f9fa"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #ddd">₱${Number(data.amount || 0).toLocaleString()}</td></tr>
        </table>
        <p>Please resubmit your payment with the correct details. Contact us if you need assistance.</p>
        <p style="color:#888;font-size:12px">Infinity Boat Works · Smart Digital Boat System</p>
      </div>`
  }),
};

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getStatusColor(status) {
  const colors = { Approved: "#22c55e", Rejected: "#ef4444", Completed: "#3b82f6", "Under Review": "#f59e0b", "Pending Signing": "#f59e0b" };
  return colors[status] || "#6b7280";
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || process.env.EMAIL_PASS === "YOUR_GMAIL_APP_PASSWORD") {
    console.log(`[EMAIL SIMULATED] To: ${to} | Subject: ${subject}`);
    return { simulated: true, to, subject };
  }
  try {
    const info = await emailTransporter.sendMail({ from: EMAIL_FROM, to, subject, html });
    console.log(`[EMAIL SENT] To: ${to} | Subject: ${subject} | ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL FAILED] To: ${to} | Error: ${err.message}`);
    throw err;
  }
}

async function fetchOrderDetails(orderId) {
  if (!supabaseServiceRole) return null;
  const { data } = await supabaseServiceRole
    .from("boat_orders")
    .select("*")
    .eq("orderId", orderId)
    .single();
  return data;
}

async function fetchPaymentDetails(paymentId) {
  if (!supabaseServiceRole) return null;
  const { data } = await supabaseServiceRole
    .from("dashboard_payments")
    .select("*")
    .eq("id", paymentId)
    .single();
  return data;
}

/* ============ SEND EMAIL API ============ */

app.post("/api/send-email", async (req, res) => {
  try {
    const { type, orderId, paymentId, recipient, data } = req.body;
    if (!type || !recipient) {
      return res.status(400).json({ error: "Missing required fields: type, recipient" });
    }

    const template = EMAIL_TEMPLATES[type];
    if (!template) {
      return res.status(400).json({ error: `Unknown email type: ${type}` });
    }

    let emailData = data || {};

    if (orderId) {
      const order = await fetchOrderDetails(orderId);
      if (order) emailData = { ...emailData, ...order };
    }

    if (paymentId) {
      const payment = await fetchPaymentDetails(paymentId);
      if (payment) emailData = { ...emailData, ...payment };
    }

    const { subject, html } = template(emailData);
    const result = await sendEmail({ to: recipient, subject, html });

    res.json(result);
  } catch (err) {
    console.error("[EMAIL API ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============ BOAT DATA (loaded from boatData.js) ============ */

app.get("/api/boat-data/:boatName", async (req, res) => {
  try {
    const boatData = await import("./boatData.js");
    const name = req.params.boatName;
    const specs = boatData.getBoatSpecs?.(name) || boatData.BOAT_SPECS?.[name] || null;
    const milestones = boatData.BOAT_MILESTONES?.[name] || null;
    res.json({ boatName: name, specs, milestones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ STATIC FILES ============ */

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use(express.static(__dirname, {
  setHeaders(res, path, stat) {
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("SERVER RUNNING");
  console.log("http://localhost:" + PORT);
  console.log("API available at http://localhost:" + PORT + "/api");
});
