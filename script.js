/*************************************************
 * Nuomi Map Tour — script.js (all-in-one)
 * - 勾選清單 ↔ 已選行程（可拖曳 + 停留時間）
 * - 建議排序 / 目前順序規劃 + Directions + ETA
 * - LocalStorage 記住狀態
 * - 類型篩選、匯出 Google Maps
 * - 午餐建議（Places）＋ 一鍵加入
 * - Autocomplete 搜尋加入
 * - PDF 一鍵套用（祝福一/二/三 一日）
 * - 手機抽屜（FAB 開關）
 *************************************************/

let map;
let markers = [];                 // 與 locationList 同索引
let directionsService;
let directionsRenderer;
let infoWindow;

let sortable = null;              // SortableJS 實例
let lastOrderedSeq = null;        // 最近一次畫線順序（匯出用）
let lastDirectionsResult = null;  // 最近一次 Directions 結果

// Places / 搜尋 / 午餐建議
let placesService;
let lunchTempMarkers = [];
let autocomplete;
let pendingPlace = null;

const STORAGE_KEY = "nuomi_tour_state_v1";

// ---- 類型顏色 ----
const typeColors = {
  "景點": "#1e90ff",
  "農遊體驗": "#2ecc71",
  "餐廳": "#f39c12",
  "民宿": "#8e44ad",
  "自訂": "#e91e63",
};

// ---- 預設停留時間（分鐘）依類型 ----
const defaultStayByType = {
  "景點": 30,
  "農遊體驗": 90,
  "餐廳": 60,
  "民宿": 0,
  "自訂": 30,
};

// ---- 景點資料（可自行增修）----
const locationList = [
  // 景點
  { name: "糯米橋", type: "景點", lat: 23.971679, lng: 120.874739 },
  { name: "音樂水車", type: "景點", lat: 23.972064, lng: 120.873682 },
  { name: "北圳弧形水橋", type: "景點", lat: 23.971324, lng: 120.875905 },
  { name: "阿婆洗衣墩", type: "景點", lat: 23.971127, lng: 120.876315 },
  { name: "碧雲宮", type: "景點", lat: 23.969956, lng: 120.878139 },
  { name: "元寶山", type: "景點", lat: 23.974038, lng: 120.878926 },
  { name: "茄苳神木", type: "景點", lat: 23.974933, lng: 120.872745 },
  { name: "北圳步道", type: "景點", lat: 23.974495, lng: 120.874096 },
  { name: "蝙蝠洞", type: "景點", lat: 23.973796, lng: 120.873537 },
  { name: "神仙島吊橋", type: "景點", lat: 23.973317, lng: 120.87199 },
  // 農遊體驗
  { name: "新豐農場", type: "農遊體驗", lat: 23.970372, lng: 120.876847 },
  { name: "行者咖啡", type: "農遊體驗", lat: 23.9724,  lng: 120.8722 },
  { name: "糯米橋咖啡工坊", type: "農遊體驗", lat: 23.972136, lng: 120.87103 },
  { name: "阿坤香茅工坊", type: "農遊體驗", lat: 23.975208, lng: 120.873617 },
  { name: "梅庄休閒渡假中心", type: "農遊體驗", lat: 23.97485,  lng: 120.87498 },
  { name: "綠恩有機棉花農場", type: "農遊體驗", lat: 23.97536,  lng: 120.87388 },
  { name: "百勝村咖啡莊園", type: "農遊體驗", lat: 23.969229, lng: 120.870302 },
  // 餐廳
  { name: "裕峰餐廳", type: "餐廳", lat: 23.97288,  lng: 120.873185 },
  { name: "后頭厝餐廳", type: "餐廳", lat: 23.97071,  lng: 120.877895 },
  { name: "鄉村餐廳", type: "餐廳", lat: 23.970988, lng: 120.878377 },
  { name: "私房餐廳", type: "餐廳", lat: 23.970735, lng: 120.878629 },
  // 民宿
  { name: "春天民宿", type: "民宿", lat: 23.975046, lng: 120.873941 },
  { name: "泰雅渡假村", type: "民宿", lat: 23.972829, lng: 120.870576 },
  { name: "水岸松林露營區", type: "民宿", lat: 23.975087, lng: 120.87484 },
  { name: "神仙島山莊", type: "民宿", lat: 23.972552, lng: 120.87157 },
  { name: "覓境露營", type: "民宿", lat: 23.9724,   lng: 120.8722 },
  { name: "陽光水岸會館", type: "民宿", lat: 23.97133,  lng: 120.8709 },
];

const activeTypes = new Set(["景點", "農遊體驗", "餐廳", "民宿"]);

// ================== Map Init ==================
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 23.9719, lng: 120.8715 },
    zoom: 15,
    mapId: "DEMO_MAP_ID", // 有則用自己的，沒有也可正常 fallback
    gestureHandling: "greedy",
    fullscreenControl: true,
    mapTypeControl: false,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ map });
  infoWindow = new google.maps.InfoWindow();
  placesService = new google.maps.places.PlacesService(map);

  populateStartSelect();
  loadLocations();
  bindGlobalControls();

  // Autocomplete 初始化
  const input = document.getElementById("placeSearch");
  if (input) {
    autocomplete = new google.maps.places.Autocomplete(input, {
      fields: ["place_id", "name", "geometry", "types", "formatted_address"],
    });
    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      pendingPlace = place && place.geometry ? place : null;
      renderSearchInfo(pendingPlace);
      if (pendingPlace?.geometry?.location) {
        map.panTo(pendingPlace.geometry.location);
        if (map.getZoom() < 16) map.setZoom(16);
      }
    });
  }
  document.getElementById("addSearchPlace")?.addEventListener("click", addSearchedPlaceToItinerary);

  applyTypeFilters();
  locationList.forEach((_, i) => setMarkerSelected(i, false));

  // 還原狀態
  restoreState();

  // 手機抽屜
  initDrawerControls();
}

// 綁定側欄固定控制元件
function bindGlobalControls() {
  // 類型篩選／批次
  document.querySelectorAll(".type-filter").forEach(box => {
    box.addEventListener("change", () => {
      if (box.checked) activeTypes.add(box.value);
      else activeTypes.delete(box.value);
      applyTypeFilters(); saveState();
    });
  });
  document.getElementById("selectVisible")?.addEventListener("click", () => {
    locationList.forEach((loc, idx) => {
      if (!activeTypes.has(loc.type)) return;
      const cb = document.getElementById(`cb-${idx}`);
      if (cb && !cb.checked) { cb.checked = true; setMarkerSelected(idx, true); }
    });
    rebuildSelectedList(); saveState(); planRouteFromOrder();
  });
  document.getElementById("clearVisible")?.addEventListener("click", () => {
    locationList.forEach((loc, idx) => {
      if (!activeTypes.has(loc.type)) return;
      const cb = document.getElementById(`cb-${idx}`);
      if (cb && cb.checked) { cb.checked = false; setMarkerSelected(idx, false); }
    });
    rebuildSelectedList(); saveState(); clearRoute();
  });

  // 規劃/清除/匯出
  document.getElementById("planRoute")?.addEventListener("click", planRouteSuggested);
  document.getElementById("planManual")?.addEventListener("click", planRouteFromOrder);
  document.getElementById("clearRoute")?.addEventListener("click", clearRoute);
  document.getElementById("exportLink")?.addEventListener("click", () => {
    if (!lastOrderedSeq || lastOrderedSeq.length < 2) { alert("請先規劃一條路線。"); return; }
    const mode = document.getElementById("travelMode")?.value || "DRIVING";
    const url = buildGmapsUrl(lastOrderedSeq, mode);
    window.open(url, "_blank");
  });

  // 已選清單：建議排序 / 清空
  document.getElementById("suggestOrder")?.addEventListener("click", () => {
    const orderIdx = getSelectedIndicesFromList();
    if (orderIdx.length < 2) { alert("請至少選擇 2 個景點。"); return; }
    const points = orderIdx.map(i => locationList[i]);
    const startSel = document.getElementById("startSelect").value;
    let startLoc = (startSel === "first") ? points[0]
                  : (startSel === "current") ? null
                  : locationList[Number(startSel)];

    let pool = [...points];
    if (startSel !== "first" && startSel !== "current") {
      if (!orderIdx.includes(Number(document.getElementById("startSelect").value))) {
        pool.unshift(startLoc);
      }
    }
    const ordered = (startSel === "current")
      ? points
      : nearestNeighbor(pool, startLoc || points[0]);

    const newIdxOrder = ordered
      .filter(p => p.name !== "我的位置")
      .map(p => locationList.findIndex(x => x.name === p.name));
    reorderSelectedList(newIdxOrder); saveState(); planRouteFromOrder();
  });

  document.getElementById("clearSelected")?.addEventListener("click", () => {
    document.querySelectorAll('#checkbox-list input[type="checkbox"]:checked')
      .forEach(cb => { cb.checked = false; setMarkerSelected(Number(cb.dataset.index), false); });
    rebuildSelectedList(); saveState(); clearRoute();
  });

  // 控制項變更 → 存檔 + 重新規劃
  document.getElementById("departTime")?.addEventListener("change", () => { saveState(); if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); });
  document.getElementById("travelMode")?.addEventListener("change", () => { saveState(); if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); });
  document.getElementById("startSelect")?.addEventListener("change", () => { saveState(); if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); });

  // 午餐建議
  document.getElementById("suggestLunch")?.addEventListener("click", suggestLunch);

  // PDF 一鍵套用
  document.getElementById("preset1D_A")?.addEventListener("click", () => {
    applyPresetByNames(
      ["糯米橋", "音樂水車", "茄苳神木", "梅庄休閒渡假中心", "阿坤香茅工坊"],
      { "梅庄休閒渡假中心": 60, "阿坤香茅工坊": 90 },
      { departTime: "09:00", travelMode: "DRIVING", startSelect: "first" }
    );
  });
  document.getElementById("preset1D_B")?.addEventListener("click", () => {
    applyPresetByNames(
      ["糯米橋", "音樂水車", "碧雲宮", "后頭厝餐廳", "蝙蝠洞", "北圳步道"],
      { "后頭厝餐廳": 60 },
      { departTime: "09:00", travelMode: "DRIVING", startSelect: "first" }
    );
  });
  document.getElementById("preset1D_C")?.addEventListener("click", () => {
    applyPresetByNames(
      ["糯米橋", "音樂水車", "百勝村咖啡莊園", "裕峰餐廳", "新豐農場"],
      { "百勝村咖啡莊園": 60, "裕峰餐廳": 60, "新豐農場": 60 },
      { departTime: "09:00", travelMode: "DRIVING", startSelect: "first" }
    );
  });
}

// ================== UI Builders ==================
function populateStartSelect() {
  const sel = document.getElementById("startSelect");
  if (!sel) return;
  sel.innerHTML = `
    <option value="first">以「第一個勾選的景點」為起點</option>
    <option value="current">使用目前位置（需授權）</option>
  `;
  const group = document.createElement("optgroup");
  group.label = "指定固定起點（不一定要勾選）";
  locationList.forEach((loc, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = loc.name;
    group.appendChild(opt);
  });
  sel.appendChild(group);
}

function loadLocations() {
  const list = document.getElementById("checkbox-list");
  if (!list) return;

  const categories = [...new Set(locationList.map(l => l.type))];
  const bounds = new google.maps.LatLngBounds();

  categories.forEach(cat => {
    const title = document.createElement("h3");
    title.textContent = cat;
    list.appendChild(title);

    locationList.filter(l => l.type === cat).forEach(loc => {
      const idx = locationList.indexOf(loc);

      const row = document.createElement("div");
      row.className = "row";
      row.dataset.index = String(idx);
      row.dataset.type = loc.type;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = `cb-${idx}`;
      cb.dataset.index = String(idx);

      const label = document.createElement("label");
      label.htmlFor = `cb-${idx}`;
      label.textContent = loc.name;

      row.appendChild(cb);
      row.appendChild(label);
      list.appendChild(row);

      // 整列可點（切換勾選）
      row.addEventListener("click", (e) => {
        if (e.target.tagName.toLowerCase() === "input") return;
        toggleCheckbox(idx, false);
      });

      // 勾選框
      cb.addEventListener("change", () => {
        setMarkerSelected(idx, cb.checked);
        const pos = getMarkerLatLng(idx);
        map.panTo(pos); if (map.getZoom() < 15) map.setZoom(15);
        rebuildSelectedList(); saveState();
        if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); else clearRoute();
      });

      // Marker
      const marker = createMarkerWithFallback(loc, idx);
      const pos = (marker.position && typeof marker.position.lat === "function")
        ? marker.position
        : new google.maps.LatLng(loc.lat, loc.lng);
      bounds.extend(pos);

      // InfoWindow
      const openInfo = () => {
        const isChecked = !!document.querySelector(`#cb-${idx}:checked`);
        const btnId = `info-toggle-${idx}`;
        const html = `
          <div style="min-width:180px">
            <div style="font-weight:700">${loc.name}</div>
            <div style="color:#666;font-size:12px;margin:2px 0 8px;">${loc.type}</div>
            <button id="${btnId}" style="padding:6px 10px;">${isChecked ? "從行程移除" : "加入行程"}</button>
          </div>`;
        infoWindow.setContent(html);
        infoWindow.open({ map, anchor: marker });
        google.maps.event.addListenerOnce(infoWindow, "domready", () => {
          const btn = document.getElementById(btnId);
          if (btn) btn.onclick = () => toggleCheckbox(idx, true);
        });
      };
      if (marker.addListener) marker.addListener("click", openInfo);
    });
  });

  if (!bounds.isEmpty()) map.fitBounds(bounds);
}

// ================== Selected list（拖曳 + 停留） ==================
function rebuildSelectedList() {
  const container = document.getElementById("selected-list");
  if (!container) return;

  const oldStay = getStayMinutesMapFromSelectedList();

  const checkedIdx = Array.from(
    document.querySelectorAll('#checkbox-list input[type="checkbox"]:checked')
  ).map(cb => Number(cb.dataset.index));

  const currentOrder = getSelectedIndicesFromList();
  const kept = currentOrder.filter(i => checkedIdx.includes(i));
  const extras = checkedIdx.filter(i => !kept.includes(i));
  const finalOrder = [...kept, ...extras];

  container.innerHTML = "";
  finalOrder.forEach(i => {
    const loc = locationList[i];
    const stay = oldStay.has(i) ? oldStay.get(i) : (defaultStayByType[loc.type] ?? 30);

    const li = document.createElement("li");
    li.dataset.index = String(i);
    li.innerHTML = `
      <span class="name">${loc.name}</span>
      <div class="staywrap">
        <label>停留</label>
        <input class="stay" type="number" min="0" step="5" value="${stay}" data-index="${i}" /> 分
      </div>
      <button class="remove" type="button" data-index="${i}">✕</button>
    `;
    container.appendChild(li);
  });

  // 刪除
  container.querySelectorAll(".remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.index);
      const cb = document.getElementById(`cb-${idx}`);
      if (cb) { cb.checked = false; setMarkerSelected(idx, false); }
      rebuildSelectedList(); saveState();
      if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); else clearRoute();
    });
  });

  // 停留時間更動
  container.querySelectorAll("input.stay").forEach(inp => {
    inp.addEventListener("change", () => {
      saveState();
      if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder();
    });
  });

  if (!sortable) {
    sortable = new Sortable(container, {
      animation: 150,
      onSort: () => { saveState(); if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); }
    });
  }
}

function getSelectedIndicesFromList() {
  const container = document.getElementById("selected-list");
  if (!container) return [];
  return Array.from(container.querySelectorAll("li")).map(li => Number(li.dataset.index));
}

function reorderSelectedList(newIdxOrder) {
  const container = document.getElementById("selected-list");
  if (!container) return;
  const oldStay = getStayMinutesMapFromSelectedList();
  container.innerHTML = "";
  newIdxOrder.forEach(i => {
    const loc = locationList[i];
    const stay = oldStay.has(i) ? oldStay.get(i) : (defaultStayByType[loc.type] ?? 30);
    const li = document.createElement("li");
    li.dataset.index = String(i);
    li.innerHTML = `
      <span class="name">${loc.name}</span>
      <div class="staywrap">
        <label>停留</label>
        <input class="stay" type="number" min="0" step="5" value="${stay}" data-index="${i}" /> 分
      </div>
      <button class="remove" type="button" data-index="${i}">✕</button>
    `;
    container.appendChild(li);
  });
  // 綁定
  container.querySelectorAll(".remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.index);
      const cb = document.getElementById(`cb-${idx}`);
      if (cb) { cb.checked = false; setMarkerSelected(idx, false); }
      rebuildSelectedList(); saveState();
      if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); else clearRoute();
    });
  });
  container.querySelectorAll("input.stay").forEach(inp => {
    inp.addEventListener("change", () => {
      saveState();
      if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder();
    });
  });
}

function getStayMinutesMapFromSelectedList() {
  const mapM = new Map();
  document.querySelectorAll("#selected-list input.stay").forEach(inp => {
    const idx = Number(inp.dataset.index);
    const val = Math.max(0, Number(inp.value || 0));
    mapM.set(idx, val);
  });
  return mapM;
}

// ================== Routing（目前順序 / 建議排序） ==================
function clearRoute() {
  directionsRenderer?.set("directions", null);
  lastOrderedSeq = null;
  const panel = document.getElementById("itinerary");
  if (panel) panel.innerHTML = "";
}

async function planRouteFromOrder() {
  const orderIdx = getSelectedIndicesFromList();
  if (orderIdx.length < 2) { alert("請至少選擇 2 個景點。"); return; }

  const mode = document.getElementById("travelMode")?.value || "DRIVING";
  const startSel = document.getElementById("startSelect")?.value || "first";
  const departStr = document.getElementById("departTime")?.value || "09:00";

  let seq = orderIdx.map(i => locationList[i]);
  if (startSel === "current") {
    try {
      const pos = await getCurrentPositionPromise();
      seq = [{ name:"我的位置", lat:pos.coords.latitude, lng:pos.coords.longitude }, ...seq];
    } catch {
      alert("無法取得目前位置，請改選其他起點或允許定位權限。");
      return;
    }
  } else if (startSel !== "first") {
    const fixed = locationList[Number(startSel)];
    const found = seq.findIndex(p => p.name === fixed.name);
    if (found === -1) seq = [fixed, ...seq];
    else if (found !== 0) { seq.splice(found,1); seq.unshift(fixed); }
  }

  drawDirectionsWithETA(seq, mode, departStr);
}

async function planRouteSuggested() {
  const checked = Array.from(document.querySelectorAll('#checkbox-list input[type="checkbox"]:checked'))
    .map(cb => Number(cb.dataset.index));
  if (checked.length < 2) { alert("請至少選擇 2 個景點。"); return; }

  const mode = document.getElementById("travelMode")?.value || "DRIVING";
  const startSel = document.getElementById("startSelect")?.value || "first";
  const departStr = document.getElementById("departTime")?.value || "09:00";

  let points = checked.map(i => locationList[i]);
  let startLoc;

  if (startSel === "current") {
    try {
      const pos = await getCurrentPositionPromise();
      startLoc = { name: "我的位置", lat: pos.coords.latitude, lng: pos.coords.longitude };
      points = [startLoc, ...points];
    } catch { alert("無法取得目前位置。"); return; }
  } else if (startSel === "first") {
    startLoc = points[0];
  } else {
    startLoc = locationList[Number(startSel)];
    if (!points.find(p => p.name === startLoc.name)) points = [startLoc, ...points];
  }

  const ordered = nearestNeighbor(points, startLoc);
  // 更新已選順序（排除「我的位置」）
  const newIdxOrder = ordered
    .filter(p => p.name !== "我的位置")
    .map(p => locationList.findIndex(x => x.name === p.name));
  reorderSelectedList(newIdxOrder); saveState();

  drawDirectionsWithETA(ordered, mode, departStr);
}

function drawDirectionsWithETA(seq, mode, departStr) {
  if (!seq || seq.length < 2) return;

  const origin = new google.maps.LatLng(seq[0].lat, seq[0].lng);
  const destination = new google.maps.LatLng(seq[seq.length - 1].lat, seq[seq.length - 1].lng);
  const waypoints = seq.slice(1, seq.length - 1).map(p => ({
    location: new google.maps.LatLng(p.lat, p.lng), stopover: true
  }));

  directionsService.route(
    { origin, destination, waypoints, travelMode: google.maps.TravelMode[mode], optimizeWaypoints: false },
    (result, status) => {
      if (status === "OK") {
        directionsRenderer.setDirections(result);
        lastOrderedSeq = seq;
        lastDirectionsResult = result;
        const stayMap = buildStayMinutesByName();
        renderItineraryWithETA(seq, result, departStr, stayMap);
      } else {
        console.error("無法規劃路線：", status);
        alert("無法規劃路線：" + status);
      }
    }
  );
}

function buildStayMinutesByName() {
  const m = {};
  document.querySelectorAll("#selected-list li").forEach(li => {
    const idx = Number(li.dataset.index);
    const name = locationList[idx].name;
    const stay = Math.max(0, Number(li.querySelector("input.stay")?.value || 0));
    m[name] = stay;
  });
  return m;
}

// ================== 行程明細（含 ETA ） ==================
function renderItineraryWithETA(seq, result, departStr, stayByName) {
  const legs = result.routes[0].legs;
  let totalMeters = 0, totalMoveSeconds = 0;
  legs.forEach(leg => { totalMeters += leg.distance.value; totalMoveSeconds += leg.duration.value; });
  const km = (totalMeters / 1000).toFixed(2);

  const [hStr, mStr] = (departStr || "09:00").split(":");
  let current = new Date();
  current.setHours(Number(hStr) || 9, Number(mStr) || 0, 0, 0);

  const rows = [];
  let totalStayMinutes = 0;

  // 第 0 站
  let arrive = new Date(current);
  let stay0 = stayByName[seq[0].name] || 0;
  let depart = new Date(arrive.getTime() + stay0 * 60000);
  if (stay0 > 0) totalStayMinutes += stay0;
  rows.push({
    idx: 1, name: seq[0].name,
    arrive, stay: stay0, depart,
    moveText: seq.length > 1 ? fmtDurationSec(legs[0].duration.value) : "-"
  });

  for (let i = 1; i < seq.length; i++) {
    const travelSec = legs[i - 1].duration.value;
    arrive = new Date(depart.getTime() + travelSec * 1000);
    const stayMin = stayByName[seq[i].name] || 0;
    if (stayMin > 0) totalStayMinutes += stayMin;
    depart = new Date(arrive.getTime() + stayMin * 60000);

    rows.push({
      idx: i + 1, name: seq[i].name,
      arrive, stay: stayMin, depart,
      moveText: (i < seq.length - 1) ? fmtDurationSec(legs[i].duration.value) : "-"
    });
  }

  const totalEnd = new Date(current.getTime() + totalMoveSeconds * 1000 + totalStayMinutes * 60000);
  const hh = Math.floor(totalMoveSeconds / 3600);
  const mm = Math.round((totalMoveSeconds % 3600) / 60);

  let panel = document.getElementById("itinerary");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "itinerary";
    document.querySelector(".sidebar")?.appendChild(panel);
  }
  panel.innerHTML = `
    <div><strong>總移動距離：</strong>${km} km</div>
    <div><strong>總移動時間：</strong>${hh > 0 ? `${hh} 小時 ` : ""}${mm} 分</div>
    <div><strong>總停留時間：</strong>${totalStayMinutes} 分</div>
    <div><strong>出發時間：</strong>${fmtTime(current)}</div>
    <div><strong>預估結束：</strong>${fmtTime(totalEnd)}</div>
    <table>
      <thead>
        <tr>
          <th>#</th><th>景點</th><th>到達</th><th>停留</th><th>離開</th><th>下段移動</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.idx}</td>
            <td>${r.name}</td>
            <td>${fmtTime(r.arrive)}</td>
            <td>${r.stay} 分</td>
            <td>${fmtTime(r.depart)}</td>
            <td>${r.moveText}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ================== 午餐建議（Places） ==================
async function suggestLunch() {
  if (!lastOrderedSeq || !lastDirectionsResult) {
    alert("請先規劃一條路線再使用午餐建議。");
    return;
  }
  const departStr = document.getElementById("departTime")?.value || "09:00";
  const legs = lastDirectionsResult.routes[0].legs;
  const seq = lastOrderedSeq;
  const stayByName = buildStayMinutesByName();

  // 出發時間
  const [hStr, mStr] = (departStr || "09:00").split(":");
  let t = new Date(); t.setHours(Number(hStr) || 9, Number(mStr) || 0, 0, 0);

  // 站點推進
  let arrive = new Date(t);
  let depart = new Date(arrive.getTime() + (stayByName[seq[0].name] || 0) * 60000);

  const noon = new Date(t); noon.setHours(12, 0, 0, 0);
  const windowMin = new Date(noon.getTime() - 60 * 60000);
  const windowMax = new Date(noon.getTime() + 60 * 60000);

  let anchor = { lat: seq[Math.floor(seq.length/2)].lat, lng: seq[Math.floor(seq.length/2)].lng };
  for (let i = 1; i < seq.length; i++) {
    const travelSec = legs[i - 1].duration.value;
    arrive = new Date(depart.getTime() + travelSec * 1000);
    if (arrive >= windowMin && arrive <= windowMax) { anchor = { lat: seq[i].lat, lng: seq[i].lng }; break; }
    const stayMin = stayByName[seq[i].name] || 0;
    const leave = new Date(arrive.getTime() + stayMin * 60000);
    if (arrive <= noon && leave >= noon) { anchor = { lat: seq[i].lat, lng: seq[i].lng }; break; }
    depart = leave;
  }

  const radius = Math.max(100, Number(document.getElementById("lunchRadius")?.value || 500));

  // 清舊標記
  lunchTempMarkers.forEach(m => m.setMap && m.setMap(null));
  lunchTempMarkers = [];

  const request = { location: new google.maps.LatLng(anchor.lat, anchor.lng), radius, type: "restaurant" };
  placesService.nearbySearch(request, (results, status) => {
    const box = document.getElementById("lunchResults");
    if (status !== google.maps.places.PlacesServiceStatus.OK || !results?.length) {
      if (box) box.innerHTML = `<div style="color:#666">在 ${radius}m 內沒有找到餐廳。</div>`;
      return;
    }
    const top = results.slice(0, 8);
    const listHtml = top.map((p, i) => {
      const rating = (p.rating != null) ? `⭐ ${p.rating}` : "";
      const addr = p.vicinity || p.formatted_address || "";
      return `
        <div style="margin:6px 0;padding:6px;border:1px dashed #ddd;border-radius:8px">
          <div style="font-weight:600">${i+1}. ${p.name} <span style="color:#666;font-weight:400">${rating}</span></div>
          <div style="color:#666">${addr}</div>
          <button data-pid="${p.place_id}" class="add-lunch" style="margin-top:4px">加入行程</button>
        </div>
      `;
    }).join("");
    if (box) {
      box.innerHTML = `<div style="margin-bottom:6px;color:#333">以「中午」所在點為中心，半徑 ${radius}m 的餐廳：</div>${listHtml}`;
      box.querySelectorAll(".add-lunch").forEach(btn => {
        btn.addEventListener("click", () => addPlaceToItinerary(btn.dataset.pid));
      });
    }
    top.forEach((p, i) => {
      const pos = p.geometry?.location; if (!pos) return;
      const m = new google.maps.Marker({ position: pos, map, label: String(i+1) });
      lunchTempMarkers.push(m);
    });
    map.panTo(request.location); if (map.getZoom() < 16) map.setZoom(16);
  });
}

function addPlaceToItinerary(placeId) {
  placesService.getDetails({ placeId, fields: ["name","geometry"] }, (place, status) => {
    if (status !== google.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    const name = place.name;

    let idx = locationList.findIndex(x => x.name === name);
    if (idx === -1) {
      locationList.push({ name, type: "餐廳", lat, lng });
      idx = locationList.length - 1;
      appendNewCheckboxRow(idx);
      createMarkerWithFallback(locationList[idx], idx);
    }
    const cb = document.getElementById(`cb-${idx}`);
    if (cb) { cb.checked = true; setMarkerSelected(idx, true); }
    rebuildSelectedList(); saveState();
    if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); else clearRoute();
    map.panTo({ lat, lng }); if (map.getZoom() < 15) map.setZoom(15);
  });
}

function appendNewCheckboxRow(idx) {
  const list = document.getElementById("checkbox-list");
  if (!list) return;
  const loc = locationList[idx];

  const row = document.createElement("div");
  row.className = "row";
  row.dataset.index = String(idx);
  row.dataset.type = loc.type;

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = `cb-${idx}`;
  cb.dataset.index = String(idx);

  const label = document.createElement("label");
  label.htmlFor = `cb-${idx}`;
  label.textContent = loc.name;

  row.appendChild(cb);
  row.appendChild(label);
  list.appendChild(row);

  row.addEventListener("click", (e) => { if (e.target.tagName.toLowerCase() !== "input") toggleCheckbox(idx, false); });
  cb.addEventListener("change", () => {
    setMarkerSelected(idx, cb.checked);
    const pos = getMarkerLatLng(idx);
    map.panTo(pos); if (map.getZoom() < 15) map.setZoom(15);
    rebuildSelectedList(); saveState();
    if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); else clearRoute();
  });

  applyTypeFilters();
}

// ================== PDF 一鍵套用 ==================
function applyPresetByNames(names, stayOverrides = {}, options = {}) {
  // 1) 清空所有勾選
  document.querySelectorAll('#checkbox-list input[type="checkbox"]').forEach(cb => {
    cb.checked = false; setMarkerSelected(Number(cb.dataset.index), false);
  });
  rebuildSelectedList();

  // 2) 依序勾選
  names.forEach(name => {
    const idx = locationList.findIndex(l => l.name === name);
    if (idx !== -1) {
      const cb = document.getElementById(`cb-${idx}`);
      if (cb) { cb.checked = true; setMarkerSelected(idx, true); }
    } else {
      console.warn("找不到地點：", name);
    }
  });

  // 3) 重建＋覆寫停留
  rebuildSelectedList();
  if (stayOverrides && Object.keys(stayOverrides).length) {
    document.querySelectorAll("#selected-list li").forEach(li => {
      const idx = Number(li.dataset.index);
      const nm = locationList[idx].name;
      const inp = li.querySelector("input.stay");
      if (inp && stayOverrides[nm] != null) {
        inp.value = Math.max(0, Number(stayOverrides[nm]));
      }
    });
  }

  // 4) 控制項
  if (options.departTime && document.getElementById("departTime")) document.getElementById("departTime").value = options.departTime;
  if (options.travelMode && document.getElementById("travelMode")) document.getElementById("travelMode").value = options.travelMode;
  if (options.startSelect && document.getElementById("startSelect")) document.getElementById("startSelect").value = options.startSelect;

  // 5) 存檔 + 規劃
  saveState();
  if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); else clearRoute();
}

// ================== 手機抽屜 ==================
function initDrawerControls() {
  const drawer = document.querySelector(".sidebar");
  const backdrop = document.getElementById("backdrop");
  const fab = document.getElementById("toggleSidebar");
  function openDrawer() { drawer?.classList.add("open"); backdrop?.classList.add("show"); }
  function closeDrawer() { drawer?.classList.remove("open"); backdrop?.classList.remove("show"); }
  fab?.addEventListener("click", openDrawer);
  backdrop?.addEventListener("click", closeDrawer);
  ["planRoute","planManual","suggestOrder"].forEach(id=>{
    document.getElementById(id)?.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 768px)").matches) closeDrawer();
    });
  });
  window.matchMedia("(min-width: 769px)").addEventListener("change", e=>{
    if (e.matches) closeDrawer();
  });
}

// ================== 距離/排序工具 ==================
function nearestNeighbor(points, startLoc) {
  const visited = [startLoc];
  const remaining = points.filter(p => p.name !== startLoc.name);
  while (remaining.length) {
    const last = visited[visited.length - 1];
    let best = null, min = Infinity;
    for (const loc of remaining) {
      const d = haversineMeters(last.lat, last.lng, loc.lat, loc.lng);
      if (d < min) { min = d; best = loc; }
    }
    visited.push(best);
    remaining.splice(remaining.findIndex(x => x.name === best.name), 1);
  }
  return visited;
}
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => d*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

// ================== Marker / Filters / Interactions ==================
function createMarkerWithFallback(loc, idx) {
  const canUseAdvanced = google.maps.marker && google.maps.marker.AdvancedMarkerElement && map.get("mapId");
  if (canUseAdvanced) {
    const pin = new google.maps.marker.PinElement({ background: typeColors[loc.type], borderColor:"#333", glyphColor:"#fff", scale:1.0 });
    const m = new google.maps.marker.AdvancedMarkerElement({
      position: { lat: loc.lat, lng: loc.lng }, map, title: loc.name, content: pin.element
    });
    markers[idx] = m; return m;
  } else {
    const m = new google.maps.Marker({
      position: { lat: loc.lat, lng: loc.lng }, map, title: loc.name,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale:7, fillColor:typeColors[loc.type],
              fillOpacity:1, strokeColor:"#333", strokeWeight:1 }
    });
    markers[idx] = m; return m;
  }
}
function applyTypeFilters() {
  locationList.forEach((loc, idx) => {
    const visible = activeTypes.has(loc.type);
    const m = markers[idx]; if (!m) return;
    if ("setMap" in m) m.setMap(visible ? map : null); else m.map = visible ? map : null;
    const row = document.querySelector(`.row[data-index="${idx}"]`);
    if (row) row.style.display = visible ? "" : "none";
  });
}
function getMarkerLatLng(idx) {
  const m = markers[idx];
  const loc = locationList[idx];
  if (!m) return new google.maps.LatLng(loc.lat, loc.lng);
  if (m.position && typeof m.position.lat === "function") return m.position; // 傳統 Marker
  return new google.maps.LatLng(loc.lat, loc.lng); // AdvancedMarker
}
function setMarkerSelected(idx, selected) {
  const loc = locationList[idx];
  const color = selected ? "#ff3366" : typeColors[loc.type];
  const m = markers[idx]; if (!m) return;
  if ("setIcon" in m) {
    m.setIcon({ path: google.maps.SymbolPath.CIRCLE, scale: selected ? 10 : 7,
      fillColor: color, fillOpacity: 1, strokeColor:"#333", strokeWeight:1 });
  } else {
    const pin = new google.maps.marker.PinElement({
      background: color, borderColor:"#333", glyphColor:"#fff", scale: selected ? 1.2 : 1.0
    });
    m.content = pin.element;
  }
}
function toggleCheckbox(idx, scrollIntoView) {
  const cb = document.getElementById(`cb-${idx}`); if (!cb) return;
  cb.checked = !cb.checked;
  setMarkerSelected(idx, cb.checked);
  if (scrollIntoView) cb.scrollIntoView({ behavior: "smooth", block: "center" });

  const pos = getMarkerLatLng(idx);
  map.panTo(pos); if (map.getZoom() < 15) map.setZoom(15);

  rebuildSelectedList(); saveState();
  if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); else clearRoute();
}

// ================== LocalStorage ==================
function saveState() {
  try {
    const orderIdx = getSelectedIndicesFromList();
    const stay = {};
    document.querySelectorAll("#selected-list input.stay").forEach(inp => {
      const idx = Number(inp.dataset.index);
      const val = Math.max(0, Number(inp.value || 0));
      stay[idx] = val;
    });
    const state = {
      v: 1,
      selectedOrder: orderIdx,
      stayByIndex: stay,
      departTime: document.getElementById("departTime")?.value || "09:00",
      travelMode: document.getElementById("travelMode")?.value || "DRIVING",
      startSelect: document.getElementById("startSelect")?.value || "first",
      activeTypes: Array.from(activeTypes),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { console.warn("saveState 失敗：", e); }
}
function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    if (!state || state.v !== 1) return;

    if (Array.isArray(state.activeTypes) && state.activeTypes.length) {
      activeTypes.clear();
      state.activeTypes.forEach(t => activeTypes.add(t));
      document.querySelectorAll(".type-filter").forEach(box => { box.checked = activeTypes.has(box.value); });
      applyTypeFilters();
    }

    if (document.getElementById("departTime") && state.departTime)
      document.getElementById("departTime").value = state.departTime;
    if (document.getElementById("travelMode") && state.travelMode)
      document.getElementById("travelMode").value = state.travelMode;
    if (document.getElementById("startSelect") && state.startSelect)
      document.getElementById("startSelect").value = state.startSelect;

    if (Array.isArray(state.selectedOrder)) {
      state.selectedOrder.forEach(idx => {
        const cb = document.getElementById(`cb-${idx}`);
        if (cb) { cb.checked = true; setMarkerSelected(idx, true); }
      });
    }
    rebuildSelectedList();

    if (state.stayByIndex) {
      document.querySelectorAll("#selected-list input.stay").forEach(inp => {
        const idx = Number(inp.dataset.index);
        if (state.stayByIndex[idx] != null) inp.value = state.stayByIndex[idx];
      });
    }

    if (getSelectedIndicesFromList().length >= 2) {
      planRouteFromOrder();
    }
  } catch (e) { console.warn("restoreState 失敗：", e); }
}

// ================== 搜尋並加入 ==================
function renderSearchInfo(place) {
  const box = document.getElementById("searchInfo");
  if (!box) return;
  if (!place) { box.textContent = "請在上方輸入並選取一個地點。"; return; }
  const addr = place.formatted_address || "";
  const typeStr = (place.types || []).slice(0,3).join(", ");
  box.innerHTML = `<div><b>${place.name}</b></div>
                   <div>${addr}</div>
                   <div style="color:#888">types: ${typeStr}</div>`;
}
function mapPlaceTypesToCategory(types = []) {
  if (types.includes("restaurant") || types.includes("food") || types.includes("cafe")) return "餐廳";
  if (types.includes("lodging")) return "民宿";
  if (types.includes("tourist_attraction") || types.includes("point_of_interest")) return "景點";
  return "自訂";
}
function addSearchedPlaceToItinerary() {
  if (!pendingPlace || !pendingPlace.geometry?.location) {
    alert("請先在上方輸入並選取一個地點。");
    return;
  }
  const lat = pendingPlace.geometry.location.lat();
  const lng = pendingPlace.geometry.location.lng();
  const name = pendingPlace.name || "未命名地點";
  const type = mapPlaceTypesToCategory(pendingPlace.types || []);

  let idx = locationList.findIndex(x => x.name === name);
  if (idx === -1) {
    locationList.push({ name, type, lat, lng });
    idx = locationList.length - 1;
    appendNewCheckboxRow(idx);
    createMarkerWithFallback(locationList[idx], idx);
  }
  const cb = document.getElementById(`cb-${idx}`);
  if (cb) { cb.checked = true; setMarkerSelected(idx, true); }
  rebuildSelectedList(); saveState();
  if (getSelectedIndicesFromList().length >= 2) planRouteFromOrder(); else clearRoute();
  map.panTo({ lat, lng }); if (map.getZoom() < 15) map.setZoom(15);
}

// ================== Utils ==================
function getCurrentPositionPromise(options = { enableHighAccuracy: true, timeout: 10000 }) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error("此瀏覽器不支援定位"));
    else navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}
function buildGmapsUrl(ordered, mode) {
  if (!ordered || ordered.length < 2) return "";
  const origin = `${ordered[0].lat},${ordered[0].lng}`;
  const destination = `${ordered[ordered.length - 1].lat},${ordered[ordered.length - 1].lng}`;
  const waypoints = ordered.slice(1, ordered.length - 1).map(p => `${p.lat},${p.lng}`).join("|");
  const m = (mode || "DRIVING").toLowerCase();
  const base = "https://www.google.com/maps/dir/?api=1";
  const params = `origin=${origin}&destination=${destination}&travelmode=${m}` +
                 (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "");
  return `${base}&${params}`;
}
function fmtTime(d) {
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${hh}:${mm}`;
}
function fmtDurationSec(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`;
}

window.initMap = initMap;
