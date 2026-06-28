import { supabase, handleDbError, sendEmailNotification } from "./supabase.js";
import { getBoatTimeline } from './boatData.js';

const canvas = document.getElementById('boatCanvas');
const ctx = canvas.getContext('2d');

let rotationAngle = 0;
let zoomLevel = 1;
let currentView = 'exterior';
let hullColor = '#111827';
let colorPrice = 0;
let inventoryItems = { engines: [], seats: [], leds: [], colors: [] };

const HULL_COLOR_PRICING = {
  'Speed Boat': 50000,
  'Passenger Boat': 100000,
  'Parasail Boat': 100000,
  'Patrol Boat': 150000
};

function getHullColorPricing() {
  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  const name = draft?.boatData?.name || '';
  const match = Object.keys(HULL_COLOR_PRICING).find(k => name.toLowerCase().includes(k.toLowerCase().split(' ')[0]));
  return match ? HULL_COLOR_PRICING[match] : 0;
}

const lengthRange = document.getElementById('lengthRange');
const widthRange = document.getElementById('widthRange');
const lengthValue = document.getElementById('lengthValue');
const widthValue = document.getElementById('widthValue');
const engineBrand = document.getElementById('engineBrand');
const engineHP = document.getElementById('engineHP');

function populateEngineHP(brand) {
  const filtered = brand ? inventoryItems.engines.filter(e => e.metadata?.brand === brand) : [];
  engineHP.innerHTML = '<option value="0" data-id="" data-name="None">None</option>' +
    filtered.map(e =>
      `<option value="${e.price}" data-id="${e.id}" data-name="${e.name}" data-hp="${e.metadata?.hp || ''}">${e.metadata?.hp || ''} HP</option>`
    ).join('');
  if (filtered.length > 0) {
    engineHP.value = filtered[0].price;
  }
}

const BOAT_PRICING = {
  'Speed Boat': { rate: 107000, stdLength: 5.8, stdWidth: 2.25 },
  '1950 Passenger Boat': { rate: 50000, stdLength: 19.5, stdWidth: 4.2 },
  '2680 Passenger Boat': { rate: 50000, stdLength: 26.8, stdWidth: 6.0 },
  'Passenger Boat': { rate: 50000, stdLength: 19.5, stdWidth: 4.2 },
  'Parasail Boat': { rate: 80000, stdLength: 11, stdWidth: 3.0 },
  'Patrol Boat': { rate: 90000, stdLength: 12, stdWidth: 3.3 }
};

function getBoatPricing() {
  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  const name = draft?.boatData?.name || '';
  const match = Object.keys(BOAT_PRICING).find(k => name.toLowerCase().includes(k.toLowerCase().split(' ')[0]));
  return match ? BOAT_PRICING[match] : { rate: 50000, stdLength: 10, stdWidth: 2.8 };
}
const seatSelect = document.getElementById('seatSelect');
const ledSelect = document.getElementById('ledSelect');
const totalPrice = document.getElementById('totalPrice');
const safetyBox = document.getElementById('safetyBox');
const recommendedSeats = document.getElementById('recommendedSeats');
const currentSeats = document.getElementById('currentSeats');
const remainingWeight = document.getElementById('remainingWeight');

const CUSTOMIZATION_SEED = [
  { name: 'Suzuki 150 HP', category: 'Engine', stock: 5, price: 700000, metadata: { brand: 'Suzuki', hp: 150, optionType: 'engine' } },
  { name: 'Suzuki 250 HP', category: 'Engine', stock: 5, price: 1346000, metadata: { brand: 'Suzuki', hp: 250, optionType: 'engine' } },
  { name: 'Suzuki 300 HP', category: 'Engine', stock: 5, price: 1469000, metadata: { brand: 'Suzuki', hp: 300, optionType: 'engine' } },
  { name: 'Mercury 150 HP', category: 'Engine', stock: 5, price: 850000, metadata: { brand: 'Mercury', hp: 150, optionType: 'engine' } },
  { name: 'Mercury 250 HP', category: 'Engine', stock: 5, price: 1400000, metadata: { brand: 'Mercury', hp: 250, optionType: 'engine' } },
  { name: 'Mercury 300 HP', category: 'Engine', stock: 5, price: 1700000, metadata: { brand: 'Mercury', hp: 300, optionType: 'engine' } },
  { name: '8 Seats', category: 'Seats', stock: 99, price: 52000, metadata: { capacity: 8, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '12 Seats', category: 'Seats', stock: 99, price: 78000, metadata: { capacity: 12, optionType: 'seats', perSeatPrice: 6500 } },
  { name: '15 Seats', category: 'Seats', stock: 99, price: 97500, metadata: { capacity: 15, optionType: 'seats', perSeatPrice: 6500 } },
  { name: 'Blue LED', category: 'LED', stock: 20, price: 25000, metadata: { ledType: 'blue', optionType: 'led' } },
  { name: 'RGB LED', category: 'LED', stock: 15, price: 45000, metadata: { ledType: 'rgb', optionType: 'led' } },
  { name: 'White Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#ffffff', optionType: 'color' } },
  { name: 'Blue Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#2563eb', optionType: 'color' } },
  { name: 'Dark Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#111827', optionType: 'color' } },
  { name: 'Red Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#dc2626', optionType: 'color' } },
  { name: 'Green Hull Paint', category: 'Color', stock: 99, price: 0, metadata: { hex: '#65a30d', optionType: 'color' } }
];

async function loadOptions() {
  let { data } = await supabase.from("inventory").select("*");
  const cats = ['Engine', 'Seats', 'LED', 'Color'];
  let customizationItems = (data || []).filter(i => cats.includes(i.category));

  if (!data || customizationItems.length === 0) {
    for (const item of CUSTOMIZATION_SEED) {
      await supabase.from("inventory").insert(item);
    }
    const { data: seeded } = await supabase.from("inventory").select("*");
    data = seeded || [];
  } else {
    const seen = new Map();
    const toDelete = [];
    customizationItems.forEach(i => {
      const key = i.category + '|' + i.name;
      if (seen.has(key)) toDelete.push(i.id);
      else seen.set(key, true);
    });
    if (toDelete.length > 0) {
      for (const id of toDelete) {
        await supabase.from("inventory").delete().eq("id", id);
      }
      const { data: cleaned } = await supabase.from("inventory").select("*");
      data = cleaned || [];
    }
  }

  const engineItems = data.filter(i => i.category === 'Engine');
  const staleEngines = engineItems.filter(e => !e.metadata?.brand);
  if (staleEngines.length > 0) {
    for (const e of engineItems) {
      await supabase.from("inventory").delete().eq("id", e.id);
    }
    for (const item of CUSTOMIZATION_SEED.filter(i => i.category === 'Engine')) {
      await supabase.from("inventory").insert(item);
    }
    const { data: refreshed } = await supabase.from("inventory").select("*");
    data = refreshed || [];
  }

  inventoryItems.engines = data.filter(i => i.category === 'Engine').sort((a, b) => a.price - b.price);
  inventoryItems.seats = data.filter(i => i.category === 'Seats').sort((a, b) => (a.metadata?.capacity || 0) - (b.metadata?.capacity || 0));
  inventoryItems.leds = data.filter(i => i.category === 'LED').sort((a, b) => a.price - b.price);
  inventoryItems.colors = data.filter(i => i.category === 'Color');

  const brands = [...new Set(inventoryItems.engines.map(e => e.metadata?.brand).filter(Boolean))].sort();
  engineBrand.innerHTML = '<option value="" data-name="None">None</option>' +
    brands.map(b => `<option value="${b}">${b}</option>`).join('');

  populateEngineHP(engineBrand.value);
  if (!engineBrand.value && brands.length > 0) {
    engineBrand.value = brands[0];
    populateEngineHP(brands[0]);
  }
  engineBrand.addEventListener('change', () => {
    populateEngineHP(engineBrand.value);
    drawBoat();
  });

  seatSelect.innerHTML = '<option value="0" data-capacity="0" data-id="" data-name="None">None</option>' +
    inventoryItems.seats.map(s =>
      `<option value="${s.price}" data-capacity="${s.metadata?.capacity || 8}" data-id="${s.id}" data-name="${s.name}">${s.name}</option>`
    ).join('');

  ledSelect.innerHTML = '<option value="0" data-id="" data-name="None">None</option>' +
    inventoryItems.leds.map(l =>
      `<option value="${l.price}" data-id="${l.id}" data-name="${l.name}">${l.name}</option>`
    ).join('');

  const colorContainer = document.querySelector('.colors');
  if (colorContainer && inventoryItems.colors.length > 0) {
    let html = '<div class="color default active" data-color="#111827" data-default="true" style="background:#111827;"></div>';
    html += inventoryItems.colors.map((c, i) =>
      `<div class="color" data-color="${c.metadata?.hex || '#2563eb'}" data-id="${c.id}" style="background:${c.metadata?.hex || '#2563eb'}"></div>`
    ).join('');
    colorContainer.innerHTML = html;
    hullColor = '#111827';
    colorPrice = 0;
    document.querySelectorAll('.color').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.color').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        hullColor = el.dataset.color;
        colorPrice = el.dataset.default === 'true' ? 0 : getHullColorPricing();
        drawBoat();
      });
    });
  }
  drawBoat();
}

function resizeCanvas() {
  const wrapper = canvas.parentElement;
  const rect = wrapper.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  drawBoat();
}

function drawBoat() {
  const w = canvas.width / window.devicePixelRatio;
  const h = canvas.height / window.devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const engineVal = parseInt(engineHP.value);
  const seatOpt = seatSelect.selectedOptions[0];
  const seats = parseInt(seatOpt?.dataset?.capacity || 8);
  const ledVal = parseInt(ledSelect.value);

  ctx.save();
  const cx = w / 2;
  const cy = h / 2;
  ctx.translate(cx, cy);
  ctx.scale(zoomLevel, zoomLevel);
  ctx.rotate(rotationAngle);

  const boatLen = len * 15;
  const boatWid = wid * 15;

  drawWater(boatLen, boatWid);
  if (currentView === 'exterior') drawExterior(boatLen, boatWid);
  else if (currentView === 'interior') drawInterior(boatLen, boatWid);
  else if (currentView === 'top') drawTopView(boatLen, boatWid);
  else if (currentView === 'rear') drawRearView(boatLen, boatWid);

  ctx.restore();

  updateSummary(len, wid, engineVal, seats, ledVal);
}

function drawWater(boatLen, boatWid) {
  const gradient = ctx.createRadialGradient(0, 40, 10, 0, 40, boatLen * 0.8);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, boatLen * 0.3, boatLen * 0.7, boatLen * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawExterior(boatLen, boatWid) {
  const hl = boatLen / 2;
  const hw = boatWid / 2;

  ctx.save();

  ctx.shadowColor = 'rgba(0,0,0,0.1)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 5;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 20);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hl, hw * 0.3);
  ctx.quadraticCurveTo(-hl * 0.6, hw * 1.2, 0, hw);
  ctx.quadraticCurveTo(hl * 0.6, hw * 1.2, hl, hw * 0.3);
  ctx.quadraticCurveTo(hl * 0.7, -hw * 0.3, hl * 0.3, -hw * 0.8);
  ctx.quadraticCurveTo(0, -hw, -hl * 0.3, -hw * 0.8);
  ctx.quadraticCurveTo(-hl * 0.7, -hw * 0.3, -hl, hw * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'transparent';

  const deckGrad = ctx.createLinearGradient(0, -hw * 0.5, 0, hw * 0.5);
  deckGrad.addColorStop(0, 'rgba(255,255,255,0.25)');
  deckGrad.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = deckGrad;
  ctx.beginPath();
  ctx.moveTo(-hl * 0.15, -hw * 0.7);
  ctx.quadraticCurveTo(0, -hw * 0.8, hl * 0.15, -hw * 0.7);
  ctx.quadraticCurveTo(hl * 0.5, -hw * 0.2, hl * 0.7, hw * 0.1);
  ctx.lineTo(-hl * 0.7, hw * 0.1);
  ctx.quadraticCurveTo(-hl * 0.5, -hw * 0.2, -hl * 0.15, -hw * 0.7);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = darkenColor(hullColor, 40);
  ctx.strokeStyle = darkenColor(hullColor, 60);
  ctx.lineWidth = 1.5;

  const cabW = boatWid * 0.5;
  const cabH = boatLen * 0.18;
  const cabX = -boatLen * 0.05;
  const cabY = -boatWid * 0.3;

  ctx.beginPath();
  ctx.roundRect(cabX - cabW / 2, cabY - cabH, cabW, cabH, 4);
  ctx.fill();
  ctx.stroke();

  const winGrad = ctx.createLinearGradient(cabX - cabW / 2 + 4, 0, cabX + cabW / 2 - 4, 0);
  winGrad.addColorStop(0, 'rgba(147, 197, 253, 0.7)');
  winGrad.addColorStop(0.5, 'rgba(191, 219, 254, 0.9)');
  winGrad.addColorStop(1, 'rgba(147, 197, 253, 0.7)');

  const winW = cabW * 0.7;
  const winH = cabH * 0.55;
  ctx.fillStyle = winGrad;
  ctx.beginPath();
  ctx.roundRect(cabX - winW / 2, cabY - cabH + 6, winW, winH, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const engX = boatLen * 0.42;
  const engY = boatWid * 0.2;
  ctx.fillStyle = '#374151';
  ctx.beginPath();
  ctx.ellipse(engX, engY, boatWid * 0.15, boatWid * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.ellipse(engX + boatWid * 0.12, engY, boatWid * 0.05, boatWid * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawInterior(boatLen, boatWid) {
  const hl = boatLen / 2;
  const hw = boatWid / 2;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 30);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hl, hw * 0.3);
  ctx.quadraticCurveTo(-hl * 0.6, hw * 1.2, 0, hw);
  ctx.quadraticCurveTo(hl * 0.6, hw * 1.2, hl, hw * 0.3);
  ctx.quadraticCurveTo(hl * 0.7, -hw * 0.3, hl * 0.3, -hw * 0.8);
  ctx.quadraticCurveTo(0, -hw, -hl * 0.3, -hw * 0.8);
  ctx.quadraticCurveTo(-hl * 0.7, -hw * 0.3, -hl, hw * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(-hl * 0.05, -hw * 0.6);
  ctx.quadraticCurveTo(0, -hw * 0.7, hl * 0.05, -hw * 0.6);
  ctx.quadraticCurveTo(hl * 0.4, -hw * 0.1, hl * 0.55, hw * 0.15);
  ctx.lineTo(-hl * 0.55, hw * 0.15);
  ctx.quadraticCurveTo(-hl * 0.4, -hw * 0.1, -hl * 0.05, -hw * 0.6);
  ctx.closePath();
  ctx.fill();

  const seatOpt = seatSelect.selectedOptions[0];
  const seats = parseInt(seatOpt?.dataset?.capacity || 8);
  const seatRows = Math.min(seats, 15);
  const rowCount = Math.ceil(seatRows / 2);
  const seatSpacing = (boatLen * 0.6) / rowCount;

  for (let i = 0; i < rowCount; i++) {
    const sx = -boatLen * 0.2 + i * seatSpacing;
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.roundRect(sx - 6, -hw * 0.1, 12, 8, 3);
    ctx.fill();
    ctx.fillStyle = '#4b5563';
    ctx.beginPath();
    ctx.roundRect(sx - 6, hw * 0.05, 12, 8, 3);
    ctx.fill();
  }

  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.roundRect(-15, -10, 30, 16, 4);
  ctx.fill();
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.arc(0, -2, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('INTERIOR LAYOUT', 0, hw * 0.7);
}

function drawTopView(boatLen, boatWid) {
  const hl = boatLen / 2;
  const hw = boatWid / 2;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 20);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hl, 0);
  ctx.quadraticCurveTo(-hl * 0.7, -hw, 0, -hw);
  ctx.quadraticCurveTo(hl * 0.7, -hw, hl, 0);
  ctx.quadraticCurveTo(hl * 0.7, hw, 0, hw);
  ctx.quadraticCurveTo(-hl * 0.7, hw, -hl, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = darkenColor(hullColor, 40);
  ctx.beginPath();
  ctx.roundRect(-boatLen * 0.08, -boatWid * 0.35, boatLen * 0.16, boatWid * 0.7, 4);
  ctx.fill();

  ctx.fillStyle = 'rgba(147, 197, 253, 0.6)';
  ctx.beginPath();
  ctx.roundRect(-boatLen * 0.05, -boatWid * 0.28, boatLen * 0.1, boatWid * 0.56, 3);
  ctx.fill();

  ctx.fillStyle = '#374151';
  ctx.beginPath();
  ctx.ellipse(hl * 0.35, 0, boatWid * 0.1, boatWid * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TOP VIEW', 0, boatWid * 0.85);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '9px Poppins, sans-serif';
  ctx.fillText('L: ' + lengthRange.value + 'm x W: ' + widthRange.value + 'm', 0, boatWid * 0.95);
}

function drawRearView(boatLen, boatWid) {
  const hw = boatWid / 2;

  ctx.fillStyle = hullColor;
  ctx.strokeStyle = darkenColor(hullColor, 20);
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(-hw, boatWid * 0.3);
  ctx.quadraticCurveTo(-hw * 0.7, boatWid * 0.1, -hw * 0.6, -boatWid * 0.2);
  ctx.quadraticCurveTo(-hw * 0.3, -boatWid * 0.5, 0, -boatWid * 0.55);
  ctx.quadraticCurveTo(hw * 0.3, -boatWid * 0.5, hw * 0.6, -boatWid * 0.2);
  ctx.quadraticCurveTo(hw * 0.7, boatWid * 0.1, hw, boatWid * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = darkenColor(hullColor, 40);
  const cabW = boatWid * 0.45;
  const cabH = boatWid * 0.25;
  ctx.beginPath();
  ctx.roundRect(-cabW / 2, -boatWid * 0.35 - cabH, cabW, cabH, 3);
  ctx.fill();
  ctx.strokeStyle = darkenColor(hullColor, 60);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(147, 197, 253, 0.6)';
  ctx.beginPath();
  ctx.roundRect(-cabW / 2 + 3, -boatWid * 0.35 - cabH + 3, cabW - 6, cabH * 0.5, 2);
  ctx.fill();

  ctx.fillStyle = '#374151';
  const engSpacing = boatWid * 0.15;
  ctx.beginPath();
  ctx.ellipse(-engSpacing, boatWid * 0.1, boatWid * 0.06, boatWid * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(engSpacing, boatWid * 0.1, boatWid * 0.06, boatWid * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('REAR VIEW', 0, boatWid * 0.65);
}

function updateSummary(len, wid, engineVal, seats, ledVal) {
  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  const originalPrice = draft?.boatData?.price
    ? parseFloat(String(draft.boatData.price).replace(/[^0-9.]/g, ''))
    : 1400000;
  const pricing = getBoatPricing();
  const stdArea = pricing.stdLength * pricing.stdWidth;
  const customArea = len * wid;
  const extraArea = Math.max(0, customArea - stdArea);
  const extensionCost = Math.round(pricing.rate * extraArea / 1000) * 1000;
  const basePrice = originalPrice + extensionCost;
  const enginePrice = parseInt(engineHP.value);
  const ledPrice = parseInt(ledSelect.value);
  const seatOpt = seatSelect.selectedOptions[0];
  const seatCapacity = parseInt(seatOpt?.dataset?.capacity || seats);
  const seatTotal = parseInt(seatSelect.value) || 0;
  const perSeatPrice = seatCapacity > 0 ? Math.round(seatTotal / seatCapacity) : 0;
  const total = basePrice + enginePrice + seatTotal + ledPrice + colorPrice;

  totalPrice.textContent = '₱' + total.toLocaleString();

  const basePriceDisplay = document.getElementById('basePriceDisplay');
  if (basePriceDisplay) basePriceDisplay.textContent = '₱' + originalPrice.toLocaleString();
  const dimensExtensionRow = document.getElementById('dimensExtensionRow');
  const dimensExtensionDisplay = document.getElementById('dimensExtensionDisplay');
  if (extensionCost > 0) {
    dimensExtensionRow.style.display = 'flex';
    dimensExtensionDisplay.textContent = '₱' + extensionCost.toLocaleString();
  } else {
    dimensExtensionRow.style.display = 'none';
  }
  const enginePriceDisplay = document.getElementById('enginePriceDisplay');
  if (enginePriceDisplay) enginePriceDisplay.textContent = '₱' + enginePrice.toLocaleString();
  const seatPriceDisplay = document.getElementById('seatPriceDisplay');
  if (seatPriceDisplay) seatPriceDisplay.textContent = seatTotal > 0 ? '₱' + seatTotal.toLocaleString() + ' (' + seatCapacity + ' × ₱' + perSeatPrice.toLocaleString() + ')' : 'None';
  const ledPriceDisplay = document.getElementById('ledPriceDisplay');
  if (ledPriceDisplay) ledPriceDisplay.textContent = '₱' + ledPrice.toLocaleString();
  const colorPriceDisplay = document.getElementById('colorPriceDisplay');
  if (colorPriceDisplay) colorPriceDisplay.textContent = colorPrice > 0 ? '₱' + colorPrice.toLocaleString() : 'None';

  const maxCap = Math.floor(8 + (len - 8) * 0.7);
  recommendedSeats.textContent = maxCap + ' Seats';
  currentSeats.textContent = seats + ' Seats';

  const remaining = maxCap - seats;
  if (remaining >= 0) {
    remainingWeight.textContent = remaining + ' Seats';
    remainingWeight.className = 'green';
  } else {
    remainingWeight.textContent = Math.abs(remaining) + ' Over Capacity';
    remainingWeight.className = '';
    remainingWeight.style.color = '#dc2626';
  }

  const safeRatio = len / wid;
  let score = 92;
  if (safeRatio < 2.5 || safeRatio > 6) score = 55;
  else if (safeRatio < 3 || safeRatio > 5) score = 70;

  const safetyHeading = safetyBox.querySelector('h3');
  const safetyText = safetyBox.querySelector('p');
  const scoreCircle = safetyBox.querySelector('.score-circle');

  if (score >= 80) {
    safetyHeading.textContent = 'SAFE & BALANCED';
    safetyHeading.style.color = '#16a34a';
    safetyText.textContent = 'Great! Your configuration is within safe limits.';
    scoreCircle.style.borderColor = '#22c55e';
  } else if (score >= 60) {
    safetyHeading.textContent = 'CAUTION';
    safetyHeading.style.color = '#ca8a04';
    safetyText.textContent = 'Consider adjusting length/width ratio for better stability.';
    scoreCircle.style.borderColor = '#eab308';
  } else {
    safetyHeading.textContent = 'UNSTABLE';
    safetyHeading.style.color = '#dc2626';
    safetyText.textContent = 'Warning: Current configuration may be unsafe. Adjust dimensions.';
    scoreCircle.style.borderColor = '#ef4444';
  }
  scoreCircle.textContent = score + '%';
}

function darkenColor(hex, amount) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.max(0, r - amount);
  g = Math.max(0, g - amount);
  b = Math.max(0, b - amount);
  return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}

lengthRange.addEventListener('input', () => {
  lengthValue.textContent = parseFloat(lengthRange.value) + 'm';
  drawBoat();
});

widthRange.addEventListener('input', () => {
  widthValue.textContent = parseFloat(widthRange.value) + 'm';
  drawBoat();
});

engineHP.addEventListener('change', drawBoat);
seatSelect.addEventListener('change', drawBoat);
ledSelect.addEventListener('change', drawBoat);

document.querySelectorAll('.color').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.color').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    hullColor = el.dataset.color;
    colorPrice = el.dataset.default === 'true' ? 0 : getHullColorPricing();
    drawBoat();
  });
});

document.getElementById('rotateBtn').addEventListener('click', () => {
  rotationAngle += Math.PI / 8;
  drawBoat();
});

document.getElementById('zoomInBtn').addEventListener('click', () => {
  zoomLevel = Math.min(2, zoomLevel + 0.1);
  drawBoat();
});

document.getElementById('zoomOutBtn').addEventListener('click', () => {
  zoomLevel = Math.max(0.3, zoomLevel - 0.1);
  drawBoat();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  rotationAngle = 0;
  zoomLevel = 1;
  drawBoat();
});

document.querySelectorAll('.view-buttons button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-buttons button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const text = btn.textContent.trim().toLowerCase();
    if (text === 'exterior') currentView = 'exterior';
    else if (text === 'interior') currentView = 'interior';
    else if (text === 'top view') currentView = 'top';
    else if (text === 'rear view') currentView = 'rear';
    drawBoat();
  });
});

document.querySelector('.reset-btn').addEventListener('click', () => {
  lengthRange.value = 10;
  widthRange.value = 2.8;
  const brands = [...new Set(inventoryItems.engines.map(e => e.metadata?.brand).filter(Boolean))].sort();
  if (brands.length > 0) {
    engineBrand.value = brands[0];
    populateEngineHP(brands[0]);
  }
  if (inventoryItems.seats.length > 0) seatSelect.value = inventoryItems.seats[0].price;
  if (inventoryItems.leds.length > 0) ledSelect.value = inventoryItems.leds[0].price;
  lengthValue.textContent = '10.0m';
  widthValue.textContent = '2.8m';
  rotationAngle = 0;
  zoomLevel = 1;
  if (inventoryItems.colors.length > 0) {
    hullColor = '#111827';
    colorPrice = 0;
    document.querySelectorAll('.color').forEach(c => c.classList.remove('active'));
    const defaultColor = document.querySelector('.color.default');
    if (defaultColor) defaultColor.classList.add('active');
  }
  drawBoat();
});

document.getElementById('saveQuoteBtn').addEventListener('click', () => {
  const seatOpt = seatSelect.selectedOptions[0];
  const seatCapacity = parseInt(seatOpt?.dataset?.capacity || 8);
  const seatTotal = parseInt(seatSelect.value) || 0;
  const enginePrice = parseInt(engineHP.value);
  const ledPrice = parseInt(ledSelect.value);
  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  const originalPrice = draft?.boatData?.price
    ? parseFloat(String(draft.boatData.price).replace(/[^0-9.]/g, ''))
    : 1400000;
  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const pricing = getBoatPricing();
  const stdArea = pricing.stdLength * pricing.stdWidth;
  const customArea = len * wid;
  const extraArea = Math.max(0, customArea - stdArea);
  const extensionCost = Math.round(pricing.rate * extraArea / 1000) * 1000;
  const basePrice = originalPrice + extensionCost;
  const total = basePrice + enginePrice + seatTotal + ledPrice + colorPrice;

  const engineBrandName = engineBrand.value || '';
  const engineHPText = engineHP.selectedOptions[0]?.textContent || '';
  const engineDisplayName = engineBrandName && engineHPText && engineHPText !== 'None' ? engineBrandName + ' ' + engineHPText : 'None';

  const items = [
    { name: 'Base Boat', amount: originalPrice }
  ];
  if (extensionCost > 0) {
    items.push({ name: 'Dimension Extension', amount: extensionCost });
  }
  items.push(
    { name: 'Engine: ' + engineDisplayName, amount: enginePrice },
    { name: 'Seats (' + seatCapacity + ' × ₱' + Math.round(seatTotal / seatCapacity).toLocaleString() + ')', amount: seatTotal },
    { name: 'LED: ' + (ledSelect.selectedOptions[0]?.dataset?.name || ''), amount: ledPrice }
  );
  if (colorPrice > 0) {
    items.push({ name: 'Hull Paint', amount: colorPrice });
  }

  const config = {
    length: lengthRange.value,
    width: widthRange.value,
    originalPrice: String(originalPrice),
    extensionCost: String(extensionCost),
    engineBrand: engineBrandName,
    engine: engineHP.value,
    engineItem: engineHP.selectedOptions[0]?.dataset?.id || '',
    engineName: engineDisplayName,
    seats: String(seatCapacity),
    seatsItem: seatSelect.selectedOptions[0]?.dataset?.id || '',
    seatsName: seatSelect.selectedOptions[0]?.dataset?.name || '',
    seatTotal: String(seatTotal),
    perSeatPrice: String(Math.round(seatTotal / seatCapacity)),
    led: ledPrice,
    ledItem: ledSelect.selectedOptions[0]?.dataset?.id || '',
    ledName: ledSelect.selectedOptions[0]?.dataset?.name || '',
    color: hullColor,
    colorPrice: String(colorPrice),
    totalPrice: '₱' + total.toLocaleString(),
    items: items,
    date: new Date().toISOString()
  };
  localStorage.setItem('boatConfig', JSON.stringify(config));
  alert('Configuration saved! Ready for quotation.');
});

let revisionOrderId = null;

(function checkRevisionMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "revision") {
    try {
      const encoded = params.get("order");
      revisionOrderId = atob(encoded);
      document.getElementById("submitReviewBtn").textContent = "Submit Revision";
      loadRevisionOrder(revisionOrderId);
    } catch (e) { console.error("Invalid revision param"); }
  }
})();

async function loadRevisionOrder(orderId) {
  const { data } = await handleDbError(
    supabase.from("boat_orders").select("*").eq("orderId", orderId).single(),
    "Load revision order"
  );
  if (!data || !data.customConfig) return;
  const cfg = data.customConfig;
  const draft = {
    boatData: { name: data.boatName?.replace(" (Custom)", ""), image: data.boatImage, price: cfg.originalPrice || data.boatPrice },
    buildType: "custom",
    contractSchedule: data.contractSchedule,
    guidelineResponses: data.guidelineResponses || {},
    comments: data.guidelineComments || {}
  };
  localStorage.setItem("customBuildDraft", JSON.stringify(draft));
  localStorage.setItem("boatConfig", JSON.stringify(cfg));

  if (cfg.length) { lengthRange.value = cfg.length; updateLengthDisplay(); }
  if (cfg.width) { widthRange.value = cfg.width; updateWidthDisplay(); }
  if (cfg.engineBrand) engineBrand.value = cfg.engineBrand;
  if (cfg.engineItem) {
    await delay(500);
    const opt = engineHP.querySelector(`option[data-id="${cfg.engineItem}"]`);
    if (opt) engineHP.value = opt.value;
  }
  if (cfg.seatsItem) {
    const sOpt = seatSelect.querySelector(`option[data-id="${cfg.seatsItem}"]`);
    if (sOpt) seatSelect.value = sOpt.value;
  }
  if (cfg.ledItem) {
    const lOpt = ledSelect.querySelector(`option[data-id="${cfg.ledItem}"]`);
    if (lOpt) ledSelect.value = lOpt.value;
  }
  hullColor = cfg.color || "#111827";
  colorPrice = parseInt(cfg.colorPrice) || 0;
  updateColorPreview();
  renderCanvas();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

document.getElementById('submitReviewBtn').addEventListener('click', async () => {
  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  const isRevision = !!revisionOrderId;
  if (!draft || !draft.boatData) {
    if (!isRevision) {
      alert('No custom build session found. Please start from the order page.');
      window.location.href = 'home.html';
      return;
    }
  }

  const originalPrice = draft?.boatData?.price
    ? parseFloat(String(draft.boatData.price).replace(/[^0-9.]/g, ''))
    : 1400000;
  const len = parseFloat(lengthRange.value);
  const wid = parseFloat(widthRange.value);
  const pricing = getBoatPricing();
  const stdArea = pricing.stdLength * pricing.stdWidth;
  const customArea = len * wid;
  const extraArea = Math.max(0, customArea - stdArea);
  const extensionCost = Math.round(pricing.rate * extraArea / 1000) * 1000;
  const basePrice = originalPrice + extensionCost;
  const seatOpt = seatSelect.selectedOptions[0];
  const seatCapacity = parseInt(seatOpt?.dataset?.capacity || 8);
  const seatTotal = parseInt(seatSelect.value) || 0;
  const enginePrice = parseInt(engineHP.value);
  const ledPrice = parseInt(ledSelect.value);
  const total = basePrice + enginePrice + seatTotal + ledPrice + colorPrice;

  const engineBrandName = engineBrand.value || '';
  const engineHPText = engineHP.selectedOptions[0]?.textContent || '';
  const engineDisplayName = engineBrandName && engineHPText && engineHPText !== 'None' ? engineBrandName + ' ' + engineHPText : 'None';

  const items = [
    { name: 'Base Boat', amount: originalPrice }
  ];
  if (extensionCost > 0) {
    items.push({ name: 'Dimension Extension', amount: extensionCost });
  }
  items.push(
    { name: 'Engine: ' + engineDisplayName, amount: enginePrice },
    { name: 'Seats (' + seatCapacity + ' × ₱' + Math.round(seatTotal / seatCapacity).toLocaleString() + ')', amount: seatTotal },
    { name: 'LED: ' + (ledSelect.selectedOptions[0]?.dataset?.name || ''), amount: ledPrice }
  );
  if (colorPrice > 0) {
    items.push({ name: 'Hull Paint', amount: colorPrice });
  }

  const config = {
    length: lengthRange.value,
    width: widthRange.value,
    engineBrand: engineBrandName,
    engine: String(enginePrice),
    engineItem: engineHP.selectedOptions[0]?.dataset?.id || '',
    engineName: engineDisplayName,
    seats: String(seatCapacity),
    seatsItem: seatSelect.selectedOptions[0]?.dataset?.id || '',
    seatsName: seatSelect.selectedOptions[0]?.dataset?.name || '',
    seatTotal: String(seatTotal),
    perSeatPrice: String(Math.round(seatTotal / seatCapacity)),
    led: String(ledPrice),
    ledItem: ledSelect.selectedOptions[0]?.dataset?.id || '',
    ledName: ledSelect.selectedOptions[0]?.dataset?.name || '',
    color: hullColor,
    colorPrice: String(colorPrice),
    totalPrice: '₱' + total.toLocaleString(),
    items: items,
    originalPrice: String(originalPrice),
    extensionCost: String(extensionCost),
    date: new Date().toISOString()
  };

  const customerName = localStorage.getItem('customerName') || '';
  const customerEmail = localStorage.getItem('customerEmail') || '';
  const priceNum = parseFloat(String(config.totalPrice).replace(/[^0-9.]/g, '')) || 0;
  const custPayMethod = document.querySelector('input[name="custPaymentMethod"]:checked')?.value || "Full Payment";

  if (isRevision) {
    const { error } = await supabase
      .from("boat_orders")
      .update({
        customConfig: config,
        boatPrice: config.totalPrice,
        status: "Under Review",
        orderPhase: "Awaiting Engineering Review",
        reviewFeedback: "",
        reviewStatus: "",
        progress: 0,
        remainingBalance: priceNum,
        updatedAt: new Date().toISOString()
      })
      .eq("orderId", revisionOrderId);
    if (error) { alert("Failed to submit revision: " + error.message); return; }
    sendEmailNotification({ type: "status_changed", recipient: customerEmail, data: { orderId: revisionOrderId, customerName, customerEmail, status: "Under Review", orderPhase: "Revision Submitted", progress: 0 } });
    sendEmailNotification({ type: "status_changed", recipient: "infinityboatsystem@gmail.com", data: { orderId: revisionOrderId, customerName, customerEmail, status: "Under Review", orderPhase: "Revision Submitted", progress: 0 } });
    localStorage.removeItem('customBuildDraft');
    localStorage.removeItem('boatConfig');
    alert('Your revised design has been submitted for review.');
    window.location.href = 'home.html';
    return;
  }

  const order = {
    orderId: 'ORD-' + Date.now(),
    boatName: draft.boatData.name + ' (Custom)',
    boatImage: draft.boatData.image,
    boatPrice: config.totalPrice,
    buildTime: 'TBD (Under Review)',
    downpayment: 'TBD',
    paymentMethod: custPayMethod,
    customerName: customerName,
    customerEmail: customerEmail,
    customerPhone: '',
    customerAddress: '',
    validId: '',
    notes: 'Custom build submitted for engineering review.',
    status: 'Under Review',
    progress: 0,
    remainingBalance: priceNum,
    orderPhase: 'Awaiting Engineering Review',
    buildType: 'custom',
    customConfig: config,
    guidelineResponses: draft.guidelineResponses || {},
    guidelineComments: draft.comments || {},
    contractSchedule: draft.contractSchedule || null,
    reviewFeedback: '',
    reviewStatus: '',
    signature: draft.contractSchedule?.signature || '',
    createdAt: new Date().toISOString()
  };

  const { error } = await supabase.from("boat_orders").insert(order);
  if (error) { alert("Failed to submit: " + error.message); return; }

  sendEmailNotification({ type: "order_created", recipient: order.customerEmail, data: order });
  sendEmailNotification({ type: "order_created", recipient: "infinityboatsystem@gmail.com", data: order });

  localStorage.removeItem('customBuildDraft');
  localStorage.removeItem('boatConfig');

  alert('Custom design submitted for engineering review! You will be notified once it has been evaluated.');
  window.location.href = 'home.html';
});

function loadBoatModelInfo() {
  const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
  if (draft?.boatData?.name) {
    const nameEl = document.getElementById('boatModelName');
    if (nameEl) nameEl.textContent = draft.boatData.name;
    const imgEl = document.getElementById('boatModelImage');
    if (imgEl && draft.boatData.image) {
      imgEl.src = draft.boatData.image;
    }
    renderTimelineSidebar(draft.boatData.name);
  }
}

function renderTimelineSidebar(boatName) {
  const timeline = getBoatTimeline(boatName);
  const durEl = document.getElementById('cfgTimelineDuration');
  const phasesEl = document.getElementById('cfgTimelinePhases');
  if (!durEl || !phasesEl || !timeline) return;

  durEl.innerHTML = 'Total Duration: <strong>' + timeline.totalDuration + '</strong>';

  phasesEl.innerHTML = timeline.phases.map(function(phase) {
    var parts = phase.split(" - ");
    var name = parts[0];
    var duration = parts[1] || "";
    return (
      '<div class="timeline-step">' +
        '<div class="timeline-dot"></div>' +
        '<div class="timeline-content">' +
          '<span class="timeline-phase-name">' + name + '</span>' +
          '<span class="timeline-phase-dur">' + duration + '</span>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

window.toggleTimelineSidebar = function() {
  var body = document.getElementById('timelineSidebarBody');
  var icon = document.getElementById('timelineToggleIcon');
  if (!body || !icon) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  icon.textContent = isOpen ? '▶' : '▼';
};

window.addEventListener('resize', resizeCanvas);
loadBoatModelInfo();

ctx.__proto__.roundRect = function (x, y, w, h, r) {
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  this.moveTo(x + r, y);
  this.lineTo(x + w - r, y);
  this.quadraticCurveTo(x + w, y, x + w, y + r);
  this.lineTo(x + w, y + h - r);
  this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  this.lineTo(x + r, y + h);
  this.quadraticCurveTo(x, y + h, x, y + h - r);
  this.lineTo(x, y + r);
  this.quadraticCurveTo(x, y, x + r, y);
  return this;
};

loadOptions().then(() => resizeCanvas());
