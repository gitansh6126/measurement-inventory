// RS Machinery V3 UI Prototype - Interactive Application Engine (Vanilla JS)
// Zero external framework dependencies; pure HTML5, CSS, and DOM APIs.

(function () {
  "use strict";

  // Deep clone initial fixture data for local state mutations
  const state = {
    currentRoute: "products",
    routeParams: {},
    currentUser: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.currentUser)),
    company: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.company)),
    users: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.users)),
    categories: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.categories)),
    products: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.products)),
    parties: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.parties)),
    vendorPrices: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.vendorPrices)),
    sales: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.sales)),
    purchases: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.purchases)),
    saleOrders: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.saleOrders)),
    purchaseOrders: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.purchaseOrders)),
    drafts: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.drafts)),
    glossary: JSON.parse(JSON.stringify(window.PROTOTYPE_DATA.glossary)),

    // Active Cart State (shared across Sales and Purchases)
    cart: {
      mode: "sale", // 'sale' | 'purchase'
      party: null,  // { id, name, type, creditScore }
      lines: []     // [{ lineId, variationId, productName, shortName, attributes, unit, quantity, price, discount, lineTotal, note, pieceId, pieceNumber, isMeasured }]
    },

    // UI View State
    productsViewMode: "grid", // 'grid' | 'table'
    inventoryViewMode: "table",
    productsExpanded: new Set(["prod_01"]),
    productsSearch: "",
    productsCategory: "",
    productsActivity: "",
    productsQuick: "",
    inventoryStage: "all",
    inventorySearch: "",
    inventoryCategory: "",
    stockInEdits: {}, // { variationId: { newStock, salePrice, minSalePrice, minStock, reason } }
    sidebarCartOpen: false,
    mobileMenuOpen: false,
    vendorPricingSupplierId: null,
    vendorPricingSupplierSearch: "",
    vendorPricingProductSearch: ""
  };

  // Utility helpers
  const formatMoney = (val) => "₹" + Number(val || 0).toLocaleString("en-IN");
  const formatDate = (isoStr) => {
    if (!isoStr) return "—";
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
    } catch (e) {
      return isoStr;
    }
  };

  function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${type === "success" 
          ? '<polyline points="20 6 9 17 4 12"/>' 
          : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
      </svg>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      if (toast && toast.style) {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.2s ease";
      }
      setTimeout(() => { if (toast && toast.remove) toast.remove(); }, 250);
    }, 3200);
  }

  function getActiveVariations(product) {
    return (product.variations || []).filter((v) => v.active !== false);
  }

  function calculateCartTotals() {
    let subtotal = 0;
    let discountTotal = 0;
    state.cart.lines.forEach((line) => {
      const gross = (Number(line.price) || 0) * (Number(line.quantity) || 0);
      const disc = Number(line.discount) || 0;
      subtotal += gross;
      discountTotal += disc;
    });
    const grandTotal = Math.max(0, subtotal - discountTotal);
    return { subtotal, discountTotal, grandTotal, itemCount: state.cart.lines.length };
  }

  function updateCartPill() {
    const pill = document.getElementById("cart-pill");
    if (!pill) return;
    if (state.cart.lines.length === 0) {
      pill.style.display = "none";
      return;
    }
    pill.style.display = "flex";
    const title = state.cart.mode === "sale" ? "Sale Cart" : "Purchase Cart";
    const countText = `${state.cart.lines.length} item${state.cart.lines.length > 1 ? "s" : ""}`;
    const totals = calculateCartTotals();
    document.getElementById("cart-pill-title").textContent = title;
    document.getElementById("cart-pill-count").textContent = countText;
    document.getElementById("cart-pill-total").textContent = formatMoney(totals.grandTotal);
  }

  // Navigation controller
  function navigate(route, params = {}) {
    state.currentRoute = route;
    state.routeParams = params;
    window.location.hash = route + (params.id ? `/${params.id}` : "");

    // Update sidebar navigation active links
    document.querySelectorAll(".nav-link").forEach((el) => {
      const r = el.getAttribute("data-route");
      if (r === route || (route.startsWith(r) && r !== "sales" && r !== "purchases")) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });

    toggleMobileMenu(false);
    closeModals();
    closeDrawers();
    renderCurrentRoute();
    updateCartPill();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleHashChange() {
    const hash = window.location.hash.replace(/^#\/?/, "");
    if (!hash) {
      navigate("products");
      return;
    }
    const parts = hash.split("/");
    const route = parts[0];
    const id = parts[1];
    if (route && route !== state.currentRoute) {
      navigate(route, id ? { id } : {});
    }
  }

  function toggleMobileMenu(open) {
    state.mobileMenuOpen = open;
    const sidebar = document.getElementById("app-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (sidebar) sidebar.classList.toggle("open", open);
    if (backdrop) backdrop.style.display = open ? "block" : "none";
  }

  function toggleCartSidebar(open) {
    state.sidebarCartOpen = open;
    const sidebar = document.getElementById("cart-sidebar");
    const backdrop = document.getElementById("cart-sidebar-backdrop");
    if (sidebar) sidebar.style.display = open ? "flex" : "none";
    if (backdrop) backdrop.style.display = open ? "block" : "none";
    if (open) renderSidebarCart();
  }

  function renderSidebarCart() {
    const list = document.getElementById("sidebar-cart-items");
    const heading = document.getElementById("sidebar-cart-heading");
    const sub = document.getElementById("sidebar-cart-sub");
    const totalEl = document.getElementById("sidebar-cart-total");
    if (!list) return;

    heading.textContent = state.cart.mode === "sale" ? "Active Sale Cart" : "Active Purchase Cart";
    sub.textContent = state.cart.party
      ? `For: ${state.cart.party.name}`
      : "No customer/supplier attached yet";

    const totals = calculateCartTotals();
    totalEl.textContent = formatMoney(totals.grandTotal);

    if (state.cart.lines.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 40px 10px; color: var(--slate-400);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 10px; display: block;"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
          <div style="font-weight: 500; font-size: 14px; color: var(--slate-600);">Your cart is empty</div>
          <div style="font-size: 12px; margin-top: 4px;">Select items from the product browser</div>
        </div>
      `;
      return;
    }

    list.innerHTML = state.cart.lines.map((line, idx) => `
      <div style="display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--slate-100); align-items: flex-start;">
        <div style="width: 44px; height: 44px; border-radius: 6px; background: var(--slate-100); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: var(--slate-500); flex-shrink: 0;">
          ${line.shortName.slice(0, 4)}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13px; font-weight: 600; color: var(--slate-900);">${line.productName}</div>
          <div style="font-size: 11px; font-family: var(--font-mono); color: var(--slate-500);">${line.shortName}</div>
          <div style="font-size: 12px; color: var(--slate-600); margin-top: 4px;">
            ${formatMoney(line.price)} × ${line.quantity} ${line.unit}
            ${line.discount > 0 ? `<span style="color: var(--rose-600); margin-left: 4px;">(-${formatMoney(line.discount)})</span>` : ""}
          </div>
        </div>
        <div style="text-align: right; flex-shrink: 0;">
          <div style="font-size: 13px; font-weight: 700; color: var(--brand-700);">${formatMoney(line.lineTotal)}</div>
          <button class="btn-link" style="color: var(--rose-600); font-size: 11px; margin-top: 6px;" onclick="window.RS_APP.removeCartLine(${idx})">Remove</button>
        </div>
      </div>
    `).join("");
  }

  function removeCartLine(index) {
    state.cart.lines.splice(index, 1);
    updateCartPill();
    renderSidebarCart();
    if (state.currentRoute === "sales-checkout" || state.currentRoute === "purchases-checkout") {
      renderCurrentRoute();
    }
    showToast("Item removed from cart");
  }

  function clearCart() {
    if (confirm("Are you sure you want to clear all items from the active cart?")) {
      state.cart.lines = [];
      updateCartPill();
      toggleCartSidebar(false);
      if (state.currentRoute === "sales-checkout" || state.currentRoute === "purchases-checkout") {
        navigate(state.cart.mode === "sale" ? "sales-new" : "purchases-new");
      }
      showToast("Cart cleared");
    }
  }

  function proceedToCheckout() {
    toggleCartSidebar(false);
    navigate(state.cart.mode === "sale" ? "sales-checkout" : "purchases-checkout");
  }

  // Close modals & drawers
  function closeModals() {
    const root = document.getElementById("modal-root");
    if (root) root.innerHTML = "";
  }

  function closeDrawers() {
    const root = document.getElementById("drawer-root");
    if (root) root.innerHTML = "";
  }

  // ==========================================
  // VIEW RENDERERS
  // ==========================================

  function renderCurrentRoute() {
    const root = document.getElementById("app-root");
    if (!root) return;

    switch (state.currentRoute) {
      case "products":
        renderProductsView(root);
        break;
      case "categories":
        renderCategoriesView(root);
        break;
      case "inventory":
        renderStockInView(root);
        break;
      case "sales-new":
        renderSalesNewView(root);
        break;
      case "sales-checkout":
        renderCheckoutView(root, "sale");
        break;
      case "sales-orders":
        renderOrdersView(root, "SALE");
        break;
      case "sale-order-detail":
        renderOrderDetailView(root, state.routeParams.id, "SALE");
        break;
      case "sales-history":
        renderDocumentHistoryView(root, "sale");
        break;
      case "sale-document":
        renderDocumentDetailView(root, state.routeParams.id, "sale");
        break;
      case "purchases-new":
        renderPurchasesNewView(root);
        break;
      case "purchases-checkout":
        renderCheckoutView(root, "purchase");
        break;
      case "purchases-orders":
        renderOrdersView(root, "PURCHASE");
        break;
      case "purchase-order-detail":
        renderOrderDetailView(root, state.routeParams.id, "PURCHASE");
        break;
      case "purchases-history":
        renderDocumentHistoryView(root, "purchase");
        break;
      case "purchase-document":
        renderDocumentDetailView(root, state.routeParams.id, "purchase");
        break;
      case "supplier-prices":
        renderSupplierPricesView(root);
        break;
      case "customers":
        renderPartiesView(root, "CUSTOMER");
        break;
      case "suppliers":
        renderPartiesView(root, "SUPPLIER");
        break;
      case "party-detail":
        renderPartyDetailView(root, state.routeParams.id);
        break;
      case "users":
        renderUsersView(root);
        break;
      case "backup":
        renderBackupView(root);
        break;
      case "settings":
        renderSettingsView(root);
        break;
      case "glossary":
        renderGlossaryView(root);
        break;
      case "login":
        renderLoginView(root);
        break;
      case "image-editor":
        renderImageEditorView(root);
        break;
      default:
        renderProductsView(root);
    }
  }

  // ------------------------------------------
  // 1. PRODUCTS VIEW
  // ------------------------------------------
  function renderProductsView(container) {
    // Compute KPIs
    let totalProducts = state.products.length;
    let totalVariations = 0;
    let inStockCount = 0;
    let lowStockCount = 0;
    let outStockCount = 0;
    let totalValuation = 0;

    state.products.forEach((p) => {
      const vars = getActiveVariations(p);
      totalVariations += vars.length;
      vars.forEach((v) => {
        const stock = Number(v.stock) || 0;
        const cost = Number(v.purchaseCost) || 0;
        totalValuation += stock * cost;
        if (stock <= 0) {
          outStockCount++;
        } else if (stock <= (v.lowStockThreshold || 0)) {
          lowStockCount++;
        } else {
          inStockCount++;
        }
      });
    });

    // Filter products
    const filteredProducts = state.products.filter((p) => {
      if (state.productsCategory && p.categoryId !== state.productsCategory) return false;
      if (state.productsActivity && p.activityStatus !== state.productsActivity) return false;
      if (state.productsSearch) {
        const q = state.productsSearch.toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchCode = p.baseShortName.toLowerCase().includes(q);
        const matchVar = p.variations.some((v) => v.shortName.toLowerCase().includes(q) || (v.officialSku && v.officialSku.toLowerCase().includes(q)));
        if (!matchName && !matchCode && !matchVar) return false;
      }
      if (state.productsQuick === "low") {
        const hasLow = p.variations.some((v) => v.stock > 0 && v.stock <= v.lowStockThreshold);
        if (!hasLow) return false;
      } else if (state.productsQuick === "out") {
        const hasOut = p.variations.some((v) => v.stock <= 0);
        if (!hasOut) return false;
      }
      return true;
    });

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>
              Products &amp; Inventory Status
            </h1>
            <span class="page-subtitle">${totalProducts} products · ${totalVariations} SKUs</span>
          </div>
          <div class="page-actions">
            <div class="segmented-control" role="group" aria-label="View toggle">
              <button class="segmented-btn ${state.productsViewMode === "grid" ? "active" : ""}" onclick="window.RS_APP.setProductsViewMode('grid')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 3px;"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                Grid
              </button>
              <button class="segmented-btn ${state.productsViewMode === "table" ? "active" : ""}" onclick="window.RS_APP.setProductsViewMode('table')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 3px;"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                Table
              </button>
            </div>
            <button class="btn btn-secondary" onclick="window.RS_APP.exportCsv()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export
            </button>
            <button class="btn btn-primary" onclick="window.RS_APP.openAddProductModal()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Product
            </button>
          </div>
        </div>
      </div>

      <!-- KPI Strip -->
      <div class="stat-strip cols-5">
        <button class="stat-cell" onclick="window.RS_APP.setQuickFilter('')">
          <span class="stat-icon slate">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          </span>
          <span class="stat-info">
            <span class="stat-label">Total SKUs</span>
            <span class="stat-val-row"><span class="stat-value">${totalVariations}</span> <span class="stat-sub">in ${totalProducts} items</span></span>
          </span>
        </button>

        <button class="stat-cell" onclick="window.RS_APP.setQuickFilter('')">
          <span class="stat-icon green">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          <span class="stat-info">
            <span class="stat-label">In Stock</span>
            <span class="stat-val-row"><span class="stat-value">${inStockCount}</span> <span class="stat-sub">healthy</span></span>
          </span>
        </button>

        <button class="stat-cell ${state.productsQuick === "low" ? "active" : ""}" onclick="window.RS_APP.setQuickFilter('low')">
          <span class="stat-icon amber">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </span>
          <span class="stat-info">
            <span class="stat-label">Low Stock</span>
            <span class="stat-val-row"><span class="stat-value" style="color: var(--amber-700);">${lowStockCount}</span> <span class="stat-sub">reorder</span></span>
          </span>
        </button>

        <button class="stat-cell ${state.productsQuick === "out" ? "active" : ""}" onclick="window.RS_APP.setQuickFilter('out')">
          <span class="stat-icon red">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          </span>
          <span class="stat-info">
            <span class="stat-label">Out of Stock</span>
            <span class="stat-val-row"><span class="stat-value red">${outStockCount}</span> <span class="stat-sub">critical</span></span>
          </span>
        </button>

        <div class="stat-cell">
          <span class="stat-icon orange">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </span>
          <span class="stat-info">
            <span class="stat-label">Inventory Value</span>
            <span class="stat-val-row"><span class="stat-value">${formatMoney(totalValuation)}</span></span>
          </span>
        </div>
      </div>

      <!-- Filters & Toolbar -->
      <div class="toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="search-input" placeholder="Search product name, base code, or SKU…" value="${state.productsSearch}" oninput="window.RS_APP.setProductsSearch(this.value)">
          ${state.productsSearch ? `<button class="search-clear" onclick="window.RS_APP.setProductsSearch('')">&times;</button>` : ""}
        </div>

        <select class="select-input" onchange="window.RS_APP.setProductsCategory(this.value)" aria-label="Category filter">
          <option value="">All Categories</option>
          ${state.categories.map((c) => `<option value="${c.id}" ${state.productsCategory === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>

        <select class="select-input" onchange="window.RS_APP.setProductsActivity(this.value)" aria-label="Sales activity filter">
          <option value="">All Sales Activity</option>
          <option value="Active" ${state.productsActivity === "Active" ? "selected" : ""}>Active (Recent)</option>
          <option value="Min-Active" ${state.productsActivity === "Min-Active" ? "selected" : ""}>Min-Active</option>
          <option value="Inactive" ${state.productsActivity === "Inactive" ? "selected" : ""}>Inactive</option>
          <option value="Never Sold" ${state.productsActivity === "Never Sold" ? "selected" : ""}>Never Sold</option>
        </select>

        <div style="display: flex; gap: 4px; margin-left: auto;">
          <button class="btn btn-sm ${!state.productsQuick ? "btn-secondary" : "btn-secondary"}" style="${!state.productsQuick ? "background: var(--slate-100); font-weight:600;" : ""}" onclick="window.RS_APP.setQuickFilter('')">All</button>
          <button class="btn btn-sm btn-secondary" style="${state.productsQuick === "low" ? "background: var(--amber-100); color: var(--amber-800); font-weight:600;" : ""}" onclick="window.RS_APP.setQuickFilter('low')">Low Stock</button>
          <button class="btn btn-sm btn-secondary" style="${state.productsQuick === "out" ? "background: var(--rose-100); color: var(--rose-700); font-weight:600;" : ""}" onclick="window.RS_APP.setQuickFilter('out')">Out of Stock</button>
        </div>
      </div>

      <!-- Main Display Mode (Grid or Table) -->
      ${state.productsViewMode === "grid" 
        ? renderProductsGrid(filteredProducts) 
        : renderProductsTable(filteredProducts)}
    `;
  }

  function renderProductsGrid(products) {
    if (products.length === 0) {
      return `
        <div class="card" style="padding: 48px; text-align: center; color: var(--slate-500);">
          <div style="font-size: 16px; font-weight: 600; color: var(--slate-800);">No products found</div>
          <p style="font-size: 13px; margin-top: 4px;">Try clearing filters or search terms.</p>
        </div>
      `;
    }

    return `
      <div class="catalog-layout">
        <aside class="category-rail">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--slate-500); padding: 4px 8px; letter-spacing: 0.05em;">Categories</div>
          <button class="cat-pill ${!state.productsCategory ? "active" : ""}" onclick="window.RS_APP.setProductsCategory('')">
            <span>All Categories</span>
            <span style="font-size: 11px; opacity: 0.7;">${state.products.length}</span>
          </button>
          ${state.categories.map((c) => `
            <button class="cat-pill ${state.productsCategory === c.id ? "active" : ""}" onclick="window.RS_APP.setProductsCategory('${c.id}')">
              <span style="text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.name}</span>
              <span style="font-size: 11px; opacity: 0.7;">${c.count}</span>
            </button>
          `).join("")}
        </aside>

        <section class="cards-grid">
          ${products.map((p) => {
            const vars = getActiveVariations(p);
            const prices = vars.map((v) => Number(v.salePrice) || 0).filter((v) => v > 0);
            const minPrices = vars.map((v) => Number(v.minSalePrice) || 0).filter((v) => v > 0);
            const totalStock = vars.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
            const hasShortage = vars.some((v) => v.stock <= 0);
            const hasLow = vars.some((v) => v.stock > 0 && v.stock <= v.lowStockThreshold);

            let stockChip = `<span class="chip chip-active">In Stock (${totalStock} ${p.unit}s)</span>`;
            if (hasShortage) {
              stockChip = `<span class="chip chip-rose">Shortage (${totalStock} ${p.unit}s)</span>`;
            } else if (hasLow) {
              stockChip = `<span class="chip chip-amber">Low Stock (${totalStock} ${p.unit}s)</span>`;
            }

            const minPriceStr = minPrices.length ? formatMoney(Math.min(...minPrices)) : "—";
            const salePriceStr = prices.length ? (Math.min(...prices) === Math.max(...prices) ? formatMoney(Math.min(...prices)) : `${formatMoney(Math.min(...prices))} – ${formatMoney(Math.max(...prices))}`) : "—";

            return `
              <div class="product-card" onclick="window.RS_APP.openProductDetailModal('${p.id}')">
                <div class="card-thumb">
                  <div style="font-weight: 700; font-size: 16px; color: var(--slate-500);">${p.baseShortName}</div>
                  <span style="position: absolute; top: 6px; left: 6px; background: rgba(0,0,0,0.6); color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
                    ${p.productType}
                  </span>
                </div>
                <div class="card-title">${p.name}</div>
                <div class="card-code">${p.baseShortName} · ${p.categoryName}</div>
                <div>${stockChip}</div>
                <div class="card-prices">
                  <span style="font-size: 11px; color: var(--slate-500);">Min: ${minPriceStr}</span>
                  <span class="card-selling-price">Selling: ${salePriceStr}</span>
                </div>
              </div>
            `;
          }).join("")}
        </section>
      </div>
    `;
  }

  function renderProductsTable(products) {
    return `
      <div class="table-card">
        <table class="table">
          <thead>
            <tr>
              <th style="width: 36px;"></th>
              <th>Product Name</th>
              <th>Base Code</th>
              <th>Category</th>
              <th>Stock on Hand</th>
              <th>Price Range (Min – Selling)</th>
              <th>Activity</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${products.map((p) => {
              const isExpanded = state.productsExpanded.has(p.id);
              const vars = getActiveVariations(p);
              const totalStock = vars.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
              const prices = vars.map((v) => Number(v.salePrice) || 0).filter((v) => v > 0);
              const minPrices = vars.map((v) => Number(v.minSalePrice) || 0).filter((v) => v > 0);
              const minPriceStr = minPrices.length ? formatMoney(Math.min(...minPrices)) : "—";
              const salePriceStr = prices.length ? (Math.min(...prices) === Math.max(...prices) ? formatMoney(Math.min(...prices)) : `${formatMoney(Math.min(...prices))} – ${formatMoney(Math.max(...prices))}`) : "—";

              const activityCls = p.activityStatus === "Active" ? "chip-active" : p.activityStatus === "Min-Active" ? "chip-amber" : "chip-slate";

              return `
                <tr style="cursor: pointer; background: #fff;" onclick="window.RS_APP.toggleProductRow('${p.id}')">
                  <td style="text-align: center;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${isExpanded ? "rotate(90deg)" : "rotate(0deg)"}; transition: transform 0.15s ease;">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </td>
                  <td>
                    <div style="font-weight: 600; color: var(--slate-900);">${p.name}</div>
                    <div style="font-size: 11px; color: var(--slate-500);">${vars.length} variation${vars.length > 1 ? "s" : ""} · ${p.unit}</div>
                  </td>
                  <td><code style="font-family: var(--font-mono); font-weight: 600; color: var(--brand-700);">${p.baseShortName}</code></td>
                  <td>${p.categoryName}</td>
                  <td>
                    <span style="font-weight: 600; color: ${totalStock <= 0 ? "var(--rose-600)" : "var(--slate-800)"};">
                      ${totalStock} ${p.unit}s
                    </span>
                  </td>
                  <td>
                    <span style="font-size: 12px; color: var(--slate-500);">Min ${minPriceStr}</span> – 
                    <span style="font-weight: 600; color: var(--brand-700);">${salePriceStr}</span>
                  </td>
                  <td><span class="chip ${activityCls}">${p.activityStatus}</span></td>
                  <td style="text-align: right;" onclick="event.stopPropagation()">
                    <div class="table-actions" style="justify-content: flex-end;">
                      <button class="table-action-btn" title="View Details" onclick="window.RS_APP.openProductDetailModal('${p.id}')">Details</button>
                      <button class="table-action-btn" title="Edit Product" onclick="window.RS_APP.openEditProductModal('${p.id}')">Edit</button>
                      <button class="table-action-btn" title="Adjust Stock" onclick="window.RS_APP.openStockAdjustModal('${p.id}')">Adjust</button>
                    </div>
                  </td>
                </tr>

                ${isExpanded ? `
                  <tr class="table-subrow">
                    <td></td>
                    <td colspan="7" style="padding: 0 0 12px 0;">
                      <div style="margin: 6px 16px 12px; border: 1px solid var(--slate-200); border-radius: 6px; background: #fff; overflow: hidden;">
                        <table class="table" style="font-size: 12px; margin: 0;">
                          <thead>
                            <tr style="background: var(--slate-100);">
                              <th style="padding: 6px 12px; font-size: 10px;">SKU / Short Name</th>
                              <th style="padding: 6px 12px; font-size: 10px;">Attributes</th>
                              <th style="padding: 6px 12px; font-size: 10px;">Current Stock</th>
                              <th style="padding: 6px 12px; font-size: 10px;">Reorder Level</th>
                              <th style="padding: 6px 12px; font-size: 10px;">Min Selling</th>
                              <th style="padding: 6px 12px; font-size: 10px;">Selling Price</th>
                              <th style="padding: 6px 12px; font-size: 10px;">Cost Price</th>
                              <th style="padding: 6px 12px; font-size: 10px; text-align: right;">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${vars.map((v) => {
                              const attrPairs = Object.entries(v.attributes || {}).map(([k, val]) => `<span class="chip chip-slate" style="font-size: 10px; padding: 1px 6px;">${k}: ${val}</span>`).join(" ");
                              const stockCls = v.stock <= 0 ? "color: var(--rose-600); font-weight: 700;" : v.stock <= v.lowStockThreshold ? "color: var(--amber-700); font-weight: 600;" : "font-weight: 600;";

                              return `
                                <tr draggable="true" ondragstart="window.RS_APP.handleVarDragStart(event, '${p.id}', '${v.id}')" ondragover="window.RS_APP.handleVarDragOver(event)" ondrop="window.RS_APP.handleVarDrop(event, '${p.id}', '${v.id}')">
                                  <td style="padding: 6px 12px;">
                                    <div style="font-family: var(--font-mono); font-weight: 600; color: var(--slate-900);">${v.shortName}</div>
                                    <div style="font-size: 10px; color: var(--slate-400);">${v.officialSku || "—"}</div>
                                  </td>
                                  <td style="padding: 6px 12px;">${attrPairs || "—"}</td>
                                  <td style="padding: 6px 12px; ${stockCls}">${v.stock} ${p.unit}s</td>
                                  <td style="padding: 6px 12px; color: var(--slate-500);">${v.lowStockThreshold || 0}</td>
                                  <td style="padding: 6px 12px; color: var(--slate-600);">${formatMoney(v.minSalePrice)}</td>
                                  <td style="padding: 6px 12px; font-weight: 700; color: var(--brand-700);">${formatMoney(v.salePrice)}</td>
                                  <td style="padding: 6px 12px; color: var(--slate-500);">${formatMoney(v.purchaseCost)}</td>
                                  <td style="padding: 6px 12px; text-align: right;">
                                    <button class="table-action-btn" onclick="window.RS_APP.openVendorPricesModal('${v.id}')">Supplier Rates</button>
                                  </td>
                                </tr>
                              `;
                            }).join("")}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                ` : ""}
              `;
            }).join("")}
          </tbody>
        </table>
        <div class="pagination-bar">
          <div>Showing <b>1–${products.length}</b> of <b>${products.length}</b> products</div>
          <div class="page-nums">
            <button class="page-btn active">1</button>
          </div>
        </div>
      </div>
    `;
  }

  // ------------------------------------------
  // 2. CATEGORIES VIEW
  // ------------------------------------------
  function renderCategoriesView(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">Categories</h1>
            <span class="page-subtitle">${state.categories.length} categories configured</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="window.RS_APP.openAddCategoryModal()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Category
            </button>
          </div>
        </div>
      </div>

      <div class="table-card">
        <table class="table">
          <thead>
            <tr>
              <th>Sort Order</th>
              <th>Category Name</th>
              <th>Active Products</th>
              <th>Status</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${state.categories.map((c) => `
              <tr>
                <td style="font-weight: 600; color: var(--slate-500);">${c.sortOrder}</td>
                <td style="font-weight: 600; color: var(--slate-900);">${c.name}</td>
                <td><span class="chip chip-slate">${c.count} products</span></td>
                <td><span class="chip ${c.active ? "chip-active" : "chip-rose"}">${c.active ? "Active" : "Inactive"}</span></td>
                <td style="text-align: right;">
                  <button class="table-action-btn" onclick="window.RS_APP.editCategory('${c.id}')">Edit</button>
                  <button class="table-action-btn" onclick="window.RS_APP.toggleCategoryActive('${c.id}')">${c.active ? "Deactivate" : "Activate"}</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // ------------------------------------------
  // 3. STOCK IN / INVENTORY UPDATE VIEW
  // ------------------------------------------
  function renderStockInView(container) {
    const allVars = [];
    state.products.forEach((p) => {
      p.variations.forEach((v) => {
        allVars.push({ ...v, product: p });
      });
    });

    const filteredVars = allVars.filter((v) => {
      if (state.inventoryCategory && v.product.categoryId !== state.inventoryCategory) return false;
      if (state.inventorySearch) {
        const q = state.inventorySearch.toLowerCase();
        if (!v.product.name.toLowerCase().includes(q) && !v.shortName.toLowerCase().includes(q)) return false;
      }
      if (state.inventoryStage === "low") return v.stock > 0 && v.stock <= v.lowStockThreshold;
      if (state.inventoryStage === "out") return v.stock <= 0 && v.stock >= 0;
      if (state.inventoryStage === "negative") return v.stock < 0;
      return true;
    });

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">Stock In &amp; Inventory Manager</h1>
            <span class="page-subtitle">Update stock counts, selling prices, and reorder levels in one bulk save</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" onclick="window.RS_APP.resetStockInEdits()">Reset Changes</button>
            <button class="btn btn-primary" onclick="window.RS_APP.commitStockIn()">Save Stock In</button>
          </div>
        </div>
      </div>

      <div class="toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="search-input" placeholder="Search variation or product…" value="${state.inventorySearch}" oninput="window.RS_APP.setInventorySearch(this.value)">
        </div>

        <select class="select-input" onchange="window.RS_APP.setInventoryCategory(this.value)">
          <option value="">All Categories</option>
          ${state.categories.map((c) => `<option value="${c.id}" ${state.inventoryCategory === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>

        <div class="segmented-control" role="group">
          <button class="segmented-btn ${state.inventoryStage === "all" ? "active" : ""}" onclick="window.RS_APP.setInventoryStage('all')">All</button>
          <button class="segmented-btn ${state.inventoryStage === "low" ? "active" : ""}" onclick="window.RS_APP.setInventoryStage('low')">Low Stock</button>
          <button class="segmented-btn ${state.inventoryStage === "out" ? "active" : ""}" onclick="window.RS_APP.setInventoryStage('out')">Out of Stock</button>
          <button class="segmented-btn ${state.inventoryStage === "negative" ? "active" : ""}" onclick="window.RS_APP.setInventoryStage('negative')">Negative (&lt; 0)</button>
        </div>
      </div>

      <div class="table-card">
        <table class="table">
          <thead>
            <tr>
              <th>Product / SKU</th>
              <th>Current Stock</th>
              <th style="width: 130px;">New Stock</th>
              <th>Delta</th>
              <th style="width: 130px;">Selling Price</th>
              <th style="width: 130px;">Min Selling Price</th>
              <th style="width: 110px;">Min Stock</th>
              <th style="width: 160px;">Movement Reason</th>
            </tr>
          </thead>
          <tbody>
            ${filteredVars.map((v) => {
              const edit = state.stockInEdits[v.id] || {};
              const currentStock = Number(v.stock) || 0;
              const newStockVal = edit.newStock !== undefined ? edit.newStock : currentStock;
              const delta = Number(newStockVal) - currentStock;
              const deltaBadge = delta > 0 
                ? `<span class="chip chip-active">+${delta}</span>` 
                : delta < 0 
                ? `<span class="chip chip-rose">${delta}</span>` 
                : `<span style="color: var(--slate-400); font-size: 11px;">0</span>`;

              return `
                <tr>
                  <td>
                    <div style="font-weight: 600; color: var(--slate-900);">${v.product.name}</div>
                    <div style="font-family: var(--font-mono); font-size: 11px; color: var(--brand-700);">${v.shortName}</div>
                  </td>
                  <td>
                    <span style="font-weight: 600; ${currentStock < 0 ? "color: var(--rose-600);" : ""}">${currentStock} ${v.product.unit}s</span>
                  </td>
                  <td>
                    <input type="number" class="form-input" style="padding: 4px 8px; font-size: 13px;" value="${newStockVal}" onchange="window.RS_APP.handleStockInEdit('${v.id}', 'newStock', this.value)">
                  </td>
                  <td>${deltaBadge}</td>
                  <td>
                    <input type="number" class="form-input" style="padding: 4px 8px; font-size: 13px;" value="${edit.salePrice !== undefined ? edit.salePrice : v.salePrice}" onchange="window.RS_APP.handleStockInEdit('${v.id}', 'salePrice', this.value)">
                  </td>
                  <td>
                    <input type="number" class="form-input" style="padding: 4px 8px; font-size: 13px;" value="${edit.minSalePrice !== undefined ? edit.minSalePrice : v.minSalePrice}" onchange="window.RS_APP.handleStockInEdit('${v.id}', 'minSalePrice', this.value)">
                  </td>
                  <td>
                    <input type="number" class="form-input" style="padding: 4px 8px; font-size: 13px;" value="${edit.minStock !== undefined ? edit.minStock : v.lowStockThreshold}" onchange="window.RS_APP.handleStockInEdit('${v.id}', 'minStock', this.value)">
                  </td>
                  <td>
                    <select class="form-input" style="padding: 4px 8px; font-size: 12px;" onchange="window.RS_APP.handleStockInEdit('${v.id}', 'reason', this.value)">
                      <option value="Stock Received">Stock Received</option>
                      <option value="Opening Stock">Opening Stock</option>
                      <option value="Manual Count">Manual Count</option>
                      <option value="Return to Stock">Return to Stock</option>
                      <option value="Correction">Correction</option>
                    </select>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // ------------------------------------------
  // 4. NEW SALE / PRODUCT BROWSER
  // ------------------------------------------
  function renderSalesNewView(container) {
    state.cart.mode = "sale";
    const party = state.cart.party;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
              New Sale - Catalog Browser
            </h1>
            <span class="page-subtitle">
              Customer: <b>${party ? party.name : "Not selected (Walk-in or select below)"}</b>
            </span>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" onclick="window.RS_APP.openPartySelectDrawer('sale')">
              ${party ? "Change Customer" : "Select Customer"}
            </button>
            ${state.cart.lines.length > 0 ? `
              <button class="btn btn-primary" onclick="window.RS_APP.proceedToCheckout()">
                Proceed to Checkout (${state.cart.lines.length})
              </button>
            ` : ""}
          </div>
        </div>
      </div>

      <div class="toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="search-input" placeholder="Search goods for sale…" value="${state.productsSearch}" oninput="window.RS_APP.setProductsSearch(this.value)">
        </div>

        <select class="select-input" onchange="window.RS_APP.setProductsCategory(this.value)">
          <option value="">All Categories</option>
          ${state.categories.map((c) => `<option value="${c.id}" ${state.productsCategory === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>
      </div>

      <div class="cards-grid">
        ${state.products.map((p) => {
          const vars = getActiveVariations(p);
          const totalStock = vars.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
          const prices = vars.map((v) => Number(v.salePrice) || 0).filter((v) => v > 0);
          const salePriceStr = prices.length ? (Math.min(...prices) === Math.max(...prices) ? formatMoney(Math.min(...prices)) : `${formatMoney(Math.min(...prices))} – ${formatMoney(Math.max(...prices))}`) : "—";

          return `
            <div class="product-card" onclick="window.RS_APP.openProductCartDrawer('${p.id}', 'sale')">
              <div class="card-thumb">
                <div style="font-weight: 700; font-size: 16px; color: var(--slate-500);">${p.baseShortName}</div>
                <span style="position: absolute; top: 6px; left: 6px; background: rgba(0,0,0,0.6); color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
                  ${p.productType}
                </span>
              </div>
              <div class="card-title">${p.name}</div>
              <div class="card-code">${p.baseShortName} · ${p.categoryName}</div>
              <div>
                <span class="chip ${totalStock <= 0 ? "chip-rose" : "chip-active"}">
                  ${totalStock <= 0 ? "Out of Stock" : `${totalStock} ${p.unit}s in stock`}
                </span>
              </div>
              <div class="card-prices" style="margin-top: 6px;">
                <span class="card-selling-price">${salePriceStr}</span>
              </div>
              <button class="btn btn-secondary btn-sm" style="margin-top: 6px; width: 100%;">
                Select &amp; Add to Cart
              </button>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderPurchasesNewView(container) {
    state.cart.mode = "purchase";
    const party = state.cart.party;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
              New Purchase - Catalog Browser
            </h1>
            <span class="page-subtitle">
              Supplier: <b>${party ? party.name : "Not selected (Select below)"}</b>
            </span>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" onclick="window.RS_APP.openPartySelectDrawer('purchase')">
              ${party ? "Change Supplier" : "Select Supplier"}
            </button>
            ${state.cart.lines.length > 0 ? `
              <button class="btn btn-primary" onclick="window.RS_APP.proceedToCheckout()">
                Proceed to Checkout (${state.cart.lines.length})
              </button>
            ` : ""}
          </div>
        </div>
      </div>

      <div class="toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="search-input" placeholder="Search goods for procurement…" value="${state.productsSearch}" oninput="window.RS_APP.setProductsSearch(this.value)">
        </div>

        <select class="select-input" onchange="window.RS_APP.setProductsCategory(this.value)">
          <option value="">All Categories</option>
          ${state.categories.map((c) => `<option value="${c.id}" ${state.productsCategory === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>
      </div>

      <div class="cards-grid">
        ${state.products.map((p) => {
          const vars = getActiveVariations(p);
          const totalStock = vars.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
          const prices = vars.map((v) => Number(v.costPrice) || 0).filter((v) => v > 0);
          const costPriceStr = prices.length ? (Math.min(...prices) === Math.max(...prices) ? formatMoney(Math.min(...prices)) : `${formatMoney(Math.min(...prices))} – ${formatMoney(Math.max(...prices))}`) : "—";

          return `
            <div class="product-card" onclick="window.RS_APP.openProductCartDrawer('${p.id}', 'purchase')">
              <div class="card-thumb">
                <div style="font-weight: 700; font-size: 16px; color: var(--slate-500);">${p.baseShortName}</div>
                <span style="position: absolute; top: 6px; left: 6px; background: rgba(0,0,0,0.6); color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
                  ${p.productType}
                </span>
              </div>
              <div class="card-title">${p.name}</div>
              <div class="card-code">${p.baseShortName} · ${p.categoryName}</div>
              <div>
                <span class="chip ${totalStock <= 0 ? "chip-rose" : "chip-active"}">
                  ${totalStock <= 0 ? "Current Stock: 0" : `${totalStock} ${p.unit}s in stock`}
                </span>
              </div>
              <div class="card-prices" style="margin-top: 6px;">
                <span class="card-cost-price">Cost Est: ${costPriceStr}</span>
              </div>
              <button class="btn btn-secondary btn-sm" style="margin-top: 6px; width: 100%;">
                Select &amp; Add to Purchase Cart
              </button>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  // ------------------------------------------
  // 5. CHECKOUT VIEW (SALES / PURCHASES)
  // ------------------------------------------
  function renderCheckoutView(container, mode) {
    state.cart.mode = mode;
    const isSale = mode === "sale";
    const totals = calculateCartTotals();
    const party = state.cart.party;

    // Shortage check for sales
    const shortages = [];
    if (isSale) {
      state.cart.lines.forEach((line) => {
        let currentStock = 0;
        state.products.forEach((p) => {
          const v = p.variations.find((x) => x.id === line.variationId);
          if (v) currentStock = Number(v.stock) || 0;
        });
        if (line.quantity > currentStock) {
          shortages.push({
            name: line.productName,
            code: line.shortName,
            requested: line.quantity,
            available: currentStock
          });
        }
      });
    }

    container.innerHTML = `
      <div class="page-header">
        <button class="back-link" onclick="window.RS_APP.navigate('${isSale ? "sales-new" : "purchases-new"}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back to ${isSale ? "Sales" : "Purchases"} Catalog
        </button>
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">${isSale ? "Complete Sale Invoice" : "Complete Purchase Order / Bill"}</h1>
            <span class="page-subtitle">${state.cart.lines.length} items ready for checkout</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" onclick="window.RS_APP.holdCart()">Hold Cart (Draft)</button>
            <button class="btn btn-secondary" onclick="window.RS_APP.saveAsOrder()">Save as Order</button>
            <button class="btn btn-primary" onclick="window.RS_APP.commitCheckout()">
              ${isSale ? "Complete Sale (Generate Invoice)" : "Complete Purchase (Add Stock)"}
            </button>
          </div>
        </div>
      </div>

      ${shortages.length > 0 ? `
        <div class="card" style="border-left: 4px solid var(--rose-600); padding: 14px 18px; margin-bottom: 16px; background: #fff1f2;">
          <div style="font-weight: 700; color: var(--rose-700); font-size: 14px; display: flex; align-items: center; gap: 6px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Negative Stock Warning (Policy: Warn &amp; Allow)
          </div>
          <p style="font-size: 12px; color: var(--rose-700); margin-top: 4px;">
            The requested quantity exceeds recorded on-hand stock for ${shortages.length} item(s).
            Under the fixed Warn &amp; Allow policy, you may proceed with the sale. The negative balance will be recorded in the audit trail.
          </p>
          <ul style="margin: 8px 0 0 20px; font-size: 12px; color: var(--rose-800);">
            ${shortages.map((s) => `<li><b>${s.code}</b>: Requested ${s.requested}, only ${s.available} recorded on hand.</li>`).join("")}
          </ul>
        </div>
      ` : ""}

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 16px;">
        <!-- Left: Line items -->
        <div class="card" style="padding: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h2 style="font-size: 15px; font-weight: 600;">Items in Cart</h2>
            <button class="btn btn-secondary btn-sm" onclick="window.RS_APP.navigate('${isSale ? "sales-new" : "purchases-new"}')">+ Add More Items</button>
          </div>

          <table class="table" style="font-size: 13px;">
            <thead>
              <tr>
                <th>Item</th>
                <th>Rate</th>
                <th>Qty</th>
                <th>Discount</th>
                <th>Total</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.cart.lines.map((line, idx) => `
                <tr>
                  <td>
                    <div style="font-weight: 600; color: var(--slate-900);">${line.productName}</div>
                    <div style="font-family: var(--font-mono); font-size: 11px; color: var(--slate-500);">${line.shortName}</div>
                    ${line.pieceNumber ? `<span class="chip chip-slate" style="font-size: 10px; margin-top: 2px;">Piece: ${line.pieceNumber}</span>` : ""}
                  </td>
                  <td>${formatMoney(line.price)}</td>
                  <td>${line.quantity} ${line.unit}</td>
                  <td>${line.discount > 0 ? `<span style="color: var(--rose-600);">${formatMoney(line.discount)}</span>` : "—"}</td>
                  <td style="font-weight: 700; color: var(--brand-700);">${formatMoney(line.lineTotal)}</td>
                  <td style="text-align: right;">
                    <button class="table-action-btn" style="color: var(--rose-600);" onclick="window.RS_APP.removeCartLine(${idx})">&times;</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <!-- Right: Party & Settlement Summary -->
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <!-- Party Card -->
          <div class="card" style="padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="stat-label">${isSale ? "Customer" : "Supplier"}</span>
              <button class="btn-link" style="font-size: 12px; color: var(--brand-600);" onclick="window.RS_APP.openPartySelectDrawer('${mode}')">Change</button>
            </div>
            <div style="font-size: 15px; font-weight: 700; color: var(--slate-900);">${party ? party.name : "Walk-in Customer"}</div>
            ${party && party.creditScore ? `
              <div style="margin-top: 4px;">
                <span class="chip chip-active">Credit Score: ${party.creditScore}/100</span>
              </div>
            ` : ""}
            ${party && party.phone ? `<div style="font-size: 12px; color: var(--slate-500); margin-top: 4px;">Phone: ${party.phone}</div>` : ""}
          </div>

          <!-- Settlement Summary -->
          <div class="card" style="padding: 16px;">
            <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 12px;">Payment &amp; Totals</h3>
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
              <span style="color: var(--slate-500);">Gross Subtotal:</span>
              <span>${formatMoney(totals.subtotal)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
              <span style="color: var(--slate-500);">Discount:</span>
              <span style="color: var(--rose-600);">- ${formatMoney(totals.discountTotal)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; border-top: 1px solid var(--slate-200); padding-top: 8px; margin-bottom: 14px;">
              <span>Grand Total:</span>
              <span style="color: var(--brand-700);">${formatMoney(totals.grandTotal)}</span>
            </div>

            <div class="form-group">
              <label class="form-label">Payment Mode</label>
              <select id="checkout-payment-mode" class="form-input">
                <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                <option value="UPI">UPI / QR</option>
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
                <option value="CREDIT">Credit (Pay Later)</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Amount Paid</label>
              <input type="number" id="checkout-amount-paid" class="form-input" value="${totals.grandTotal}">
            </div>

            <div class="form-group">
              <label class="form-label">Notes</label>
              <textarea id="checkout-notes" class="form-input" rows="2" placeholder="Optional delivery or invoice notes…"></textarea>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ------------------------------------------
  // 6. SALE & PURCHASE ORDERS VIEW
  // ------------------------------------------
  function renderOrdersView(container, kind) {
    const isSale = kind === "SALE";
    const orders = isSale ? state.saleOrders : state.purchaseOrders;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">${isSale ? "Sale Orders" : "Purchase Orders"}</h1>
            <span class="page-subtitle">${orders.length} orders tracked in system</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="window.RS_APP.navigate('${isSale ? "sales-new" : "purchases-new"}')">
              + New ${isSale ? "Sale Order" : "Purchase Order"}
            </button>
          </div>
        </div>
      </div>

      <div class="table-card">
        <table class="table">
          <thead>
            <tr>
              <th>Order Number</th>
              <th>Date</th>
              <th>Expected Date</th>
              <th>${isSale ? "Customer" : "Supplier"}</th>
              <th>Status</th>
              <th>Total Amount</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map((o) => {
              const statusCls = o.status === "COMPLETED" ? "chip-active" : o.status === "ON_DELIVERY" ? "chip-amber" : o.status === "CANCELLED" ? "chip-rose" : "chip-brand";
              return `
                <tr style="cursor: pointer;" onclick="window.RS_APP.openOrderDetail('${o.id}', '${kind}')">
                  <td style="font-weight: 700; font-family: var(--font-mono); color: var(--brand-700);">${o.number}</td>
                  <td>${formatDate(o.orderDate)}</td>
                  <td>${formatDate(o.expectedDate)}</td>
                  <td style="font-weight: 600; color: var(--slate-900);">${o.partyName || "Walk-in"}</td>
                  <td><span class="chip ${statusCls}">${o.status}</span></td>
                  <td style="font-weight: 700;">${formatMoney(o.total)}</td>
                  <td style="text-align: right;" onclick="event.stopPropagation()">
                    <button class="table-action-btn" onclick="window.RS_APP.openOrderDetail('${o.id}', '${kind}')">View &amp; Progress</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderOrderDetailView(container, orderId, kind) {
    const isSale = kind === "SALE";
    const orders = isSale ? state.saleOrders : state.purchaseOrders;
    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      container.innerHTML = `<div class="card p-6">Order not found.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="page-header">
        <button class="back-link" onclick="window.RS_APP.navigate('${isSale ? "sales-orders" : "purchases-orders"}')">
          &larr; Back to ${isSale ? "Sale Orders" : "Purchase Orders"}
        </button>
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">${order.number}</h1>
            <span class="chip ${order.status === "COMPLETED" ? "chip-active" : "chip-brand"}">${order.status}</span>
          </div>
          <div class="page-actions">
            ${order.status === "PLACED" ? `
              <button class="btn btn-secondary" onclick="window.RS_APP.advanceOrderStatus('${order.id}', '${kind}', 'ON_DELIVERY')">Dispatch / On Delivery</button>
              <button class="btn btn-primary" onclick="window.RS_APP.advanceOrderStatus('${order.id}', '${kind}', 'COMPLETED')">Complete Order (Fulfill)</button>
            ` : order.status === "ON_DELIVERY" ? `
              <button class="btn btn-primary" onclick="window.RS_APP.advanceOrderStatus('${order.id}', '${kind}', 'COMPLETED')">Confirm Delivery &amp; Complete</button>
            ` : ""}
            ${order.status !== "CANCELLED" && order.status !== "COMPLETED" ? `
              <button class="btn btn-danger" onclick="window.RS_APP.cancelOrder('${order.id}', '${kind}')">Cancel Order</button>
            ` : ""}
          </div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 16px;">
        <div class="card" style="padding: 16px;">
          <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 12px;">Ordered Line Items</h3>
          <table class="table" style="font-size: 13px;">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Fulfilled</th>
                <th>Outstanding</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${order.lines.map((l) => `
                <tr>
                  <td>
                    <div style="font-weight: 600;">${l.productName}</div>
                    <div style="font-family: var(--font-mono); font-size: 11px; color: var(--slate-500);">${l.shortName}</div>
                  </td>
                  <td>${l.quantity} ${l.unit}</td>
                  <td>${l.fulfilledQuantity || 0} ${l.unit}</td>
                  <td style="font-weight: 600; color: ${l.outstandingQuantity > 0 ? "var(--amber-700)" : "var(--slate-500)"};">${l.outstandingQuantity} ${l.unit}</td>
                  <td>${formatMoney(l.price)}</td>
                  <td style="font-weight: 700; color: var(--brand-700);">${formatMoney(l.lineTotal)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <div class="card" style="padding: 16px;">
          <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">Order Details</h3>
          <div style="font-size: 13px; margin-bottom: 6px;"><b>Party:</b> ${order.partyName}</div>
          <div style="font-size: 13px; margin-bottom: 6px;"><b>Date:</b> ${formatDate(order.orderDate)}</div>
          <div style="font-size: 13px; margin-bottom: 6px;"><b>Expected Date:</b> ${formatDate(order.expectedDate)}</div>
          <div style="font-size: 13px; margin-bottom: 6px;"><b>Delivery Address:</b> ${order.deliveryAddress || "Standard Godown"}</div>
          <div style="font-size: 13px; margin-bottom: 12px;"><b>Delivery Notes:</b> ${order.deliveryNote || "—"}</div>

          <h4 style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--slate-500); border-top: 1px solid var(--slate-200); padding-top: 8px; margin-bottom: 8px;">Order History Timeline</h4>
          <div style="font-size: 12px; color: var(--slate-600);">
            ${order.events.map((e) => `
              <div style="margin-bottom: 8px; padding-left: 10px; border-left: 2px solid var(--brand-600);">
                <div style="font-weight: 600; color: var(--slate-900);">${e.status}</div>
                <div>${e.note}</div>
                <div style="font-size: 10px; color: var(--slate-400);">${e.at} by ${e.by}</div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // ------------------------------------------
  // 7. DOCUMENT HISTORY & DETAIL (INVOICES)
  // ------------------------------------------
  function renderDocumentHistoryView(container, mode) {
    const isSale = mode === "sale";
    const docs = isSale ? state.sales : state.purchases;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">${isSale ? "Sale History (Invoices)" : "Purchase History (Bills)"}</h1>
            <span class="page-subtitle">${docs.length} recorded documents</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="window.RS_APP.navigate('${isSale ? "sales-new" : "purchases-new"}')">
              + New ${isSale ? "Sale" : "Purchase"}
            </button>
          </div>
        </div>
      </div>

      <div class="table-card">
        <table class="table">
          <thead>
            <tr>
              <th>Document #</th>
              <th>Date</th>
              <th>Party</th>
              <th>Payment Mode</th>
              <th>Payment Status</th>
              <th>Total Amount</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${docs.map((d) => {
              const isCancelled = d.status === "CANCELLED";
              const payCls = d.paymentStatus === "PAID" ? "chip-active" : d.paymentStatus === "PARTIAL" ? "chip-amber" : "chip-slate";
              return `
                <tr style="cursor: pointer; ${isCancelled ? "opacity: 0.65;" : ""}" onclick="window.RS_APP.openDocumentDetail('${d.id}', '${mode}')">
                  <td style="font-family: var(--font-mono); font-weight: 700; color: var(--brand-700);">
                    ${d.number}
                    ${isCancelled ? '<span class="chip chip-rose" style="margin-left: 6px; font-size: 10px;">VOID</span>' : ""}
                  </td>
                  <td>${formatDate(d.date)}</td>
                  <td style="font-weight: 600; color: var(--slate-900);">${d.partyName || "Walk-in"}</td>
                  <td>${d.paymentMode || "—"}</td>
                  <td><span class="chip ${payCls}">${d.paymentStatus}</span></td>
                  <td style="font-weight: 700;">${formatMoney(d.total)}</td>
                  <td style="text-align: right;" onclick="event.stopPropagation()">
                    <button class="table-action-btn" onclick="window.RS_APP.openDocumentDetail('${d.id}', '${mode}')">View Bill</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDocumentDetailView(container, docId, mode) {
    const isSale = mode === "sale";
    const docs = isSale ? state.sales : state.purchases;
    const doc = docs.find((d) => d.id === docId);
    if (!doc) {
      container.innerHTML = `<div class="card p-6">Document not found.</div>`;
      return;
    }

    const isVoid = doc.status === "CANCELLED";

    container.innerHTML = `
      <div class="page-header no-print">
        <button class="back-link" onclick="window.RS_APP.navigate('${isSale ? "sales-history" : "purchases-history"}')">
          &larr; Back to History
        </button>
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">${doc.number}</h1>
            <span class="chip ${isVoid ? "chip-rose" : "chip-active"}">${doc.status}</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" onclick="window.print()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Print Invoice
            </button>
            ${!isVoid ? `
              <button class="btn btn-danger" onclick="window.RS_APP.voidDocument('${doc.id}', '${mode}')">Cancel / Void</button>
            ` : ""}
          </div>
        </div>
      </div>

      <!-- Printable A4 Document Sheet -->
      <div class="card" style="padding: 32px; max-width: 820px; margin: 0 auto; background: #fff;">
        <div style="display: flex; justify-content: space-between; border-bottom: 2px solid var(--slate-900); padding-bottom: 16px; margin-bottom: 20px;">
          <div>
            <h2 style="font-size: 22px; font-weight: 800; color: var(--slate-900);">${state.company.name}</h2>
            <div style="font-size: 12px; color: var(--slate-600); max-width: 320px;">${state.company.address}</div>
            <div style="font-size: 12px; color: var(--slate-600); margin-top: 4px;">Phone: ${state.company.phone} | GSTIN: ${state.company.gstin}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 18px; font-weight: 800; color: var(--brand-700);">${isSale ? "TAX INVOICE" : "PURCHASE BILL"}</div>
            <div style="font-family: var(--font-mono); font-size: 14px; font-weight: 700;">${doc.number}</div>
            <div style="font-size: 12px; color: var(--slate-500); margin-top: 4px;">Date: ${formatDate(doc.date)}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; font-size: 13px;">
          <div>
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--slate-400);">Billed To:</div>
            <div style="font-size: 15px; font-weight: 700; color: var(--slate-900);">${doc.partyName || "Walk-in Customer"}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--slate-400);">Payment Details:</div>
            <div>Mode: <b>${doc.paymentMode || "—"}</b></div>
            <div>Status: <b>${doc.paymentStatus}</b></div>
          </div>
        </div>

        ${isVoid ? `
          <div style="border: 1px dashed var(--rose-600); background: var(--rose-50); color: var(--rose-700); padding: 12px; border-radius: 6px; margin-bottom: 20px; font-size: 13px;">
            <b>DOCUMENT CANCELLED / VOIDED</b>: ${doc.voidReason || "No cancellation reason recorded."}
          </div>
        ` : ""}

        <table class="table" style="font-size: 13px; margin-bottom: 24px;">
          <thead>
            <tr style="background: var(--slate-100);">
              <th style="width: 40px;">#</th>
              <th>Item Description &amp; Snapshot</th>
              <th>Rate</th>
              <th>Quantity</th>
              <th>Discount</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${doc.lines.map((l, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>
                  <div style="font-weight: 600;">${l.productName}</div>
                  <div style="font-family: var(--font-mono); font-size: 11px; color: var(--slate-500);">${l.shortName}</div>
                </td>
                <td>${formatMoney(l.unitPrice || l.unitCost)}</td>
                <td>${l.quantity} ${l.unit}</td>
                <td>${l.discount > 0 ? formatMoney(l.discount) : "—"}</td>
                <td style="text-align: right; font-weight: 700;">${formatMoney(l.lineTotal)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div style="display: flex; justify-content: flex-end;">
          <div style="width: 260px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
              <span>Subtotal:</span>
              <span>${formatMoney(doc.subtotal)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
              <span>Discount:</span>
              <span>- ${formatMoney(doc.discount || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 800; border-top: 2px solid var(--slate-900); padding-top: 8px;">
              <span>Total Amount:</span>
              <span style="color: var(--brand-700);">${formatMoney(doc.total)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ------------------------------------------
  // 8. SUPPLIER PRICES MATRIX (VENDOR PRICING & PRICE HISTORY)
  // ------------------------------------------
  function renderSupplierPricesView(container) {
    const suppliers = state.parties.filter((p) => p.type === "SUPPLIER" || p.type === "BOTH");
    if (!state.vendorPricingSupplierId && suppliers.length > 0) {
      state.vendorPricingSupplierId = suppliers[0].id;
    }

    const suppSearch = (state.vendorPricingSupplierSearch || "").toLowerCase();
    const filteredSuppliers = suppliers.filter((s) => {
      if (!suppSearch) return true;
      return (
        s.name.toLowerCase().includes(suppSearch) ||
        (s.city && s.city.toLowerCase().includes(suppSearch)) ||
        (s.phone && s.phone.toLowerCase().includes(suppSearch))
      );
    });

    const activeSupplier = suppliers.find((s) => s.id === state.vendorPricingSupplierId);

    // Filter rate cards for the selected supplier
    const allSupplierRates = state.vendorPrices.filter(
      (vp) => vp.supplierId === state.vendorPricingSupplierId
    );

    const prodSearch = (state.vendorPricingProductSearch || "").toLowerCase();
    const displayRates = allSupplierRates.filter((vp) => {
      if (!prodSearch) return true;
      return (
        vp.shortName.toLowerCase().includes(prodSearch) ||
        (vp.notes && vp.notes.toLowerCase().includes(prodSearch))
      );
    });

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">Vendor Pricing &amp; Price History</h1>
            <span class="page-subtitle">Configured supplier rate cards inline. Rates prefill purchase orders, and purchases automatically update these rate cards.</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="window.RS_APP.openAddVendorPriceModal()">+ Add Supplier Rate</button>
          </div>
        </div>
      </div>

      <div class="vendor-pricing-layout">
        <!-- Left Sidebar: Vendor / Supplier Directory -->
        <aside class="vendor-sidebar">
          <div class="vendor-sidebar-header">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--slate-700); letter-spacing: 0.05em;">
              Suppliers <span class="badge-count" style="margin-left: 4px; padding: 1px 6px; border-radius: 999px; background: var(--slate-100); font-size: 10px; color: var(--slate-600);">${suppliers.length}</span>
            </div>
            ${state.vendorPricingSupplierSearch ? `
              <button onclick="window.RS_APP.setVendorPricingSupplierSearch('')" style="border:none;background:none;font-size:11px;color:var(--slate-400);cursor:pointer;">Clear</button>
            ` : ""}
          </div>

          <div style="position: relative;">
            <input
              type="text"
              class="input"
              style="width: 100%; font-size: 12px; padding: 6px 8px;"
              placeholder="Search supplier, city…"
              value="${state.vendorPricingSupplierSearch || ""}"
              oninput="window.RS_APP.setVendorPricingSupplierSearch(this.value)"
            />
          </div>

          <div class="vendor-sidebar-list">
            ${filteredSuppliers.length === 0 ? `
              <div style="padding: 16px; text-align: center; font-size: 12px; color: var(--slate-400);">No suppliers found</div>
            ` : filteredSuppliers.map((s) => {
              const isSel = s.id === state.vendorPricingSupplierId;
              const rateCount = state.vendorPrices.filter((vp) => vp.supplierId === s.id).length;
              return `
                <button
                  type="button"
                  class="vendor-pill ${isSel ? "active" : ""}"
                  onclick="window.RS_APP.setVendorPricingSupplier('${s.id}')"
                >
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
                    <span style="font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.name}</span>
                    <span class="badge-count" style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: ${isSel ? "var(--slate-800)" : "var(--slate-100)"}; color: ${isSel ? "#fff" : "var(--slate-600)"}; flex-shrink: 0;">
                      ${rateCount} rates
                    </span>
                  </div>
                  <div class="vendor-pill-sub" style="font-size: 11px; color: ${isSel ? "var(--slate-300)" : "var(--slate-500)"}; display: flex; gap: 8px;">
                    ${s.city ? `<span>📍 ${s.city}</span>` : ""}
                    ${s.phone ? `<span>📞 ${s.phone}</span>` : ""}
                  </div>
                </button>
              `;
            }).join("")}
          </div>
        </aside>

        <!-- Right Main Content Area: Rates for Selected Supplier -->
        <div style="min-width: 0; display: flex; flex-direction: column; gap: 12px;">
          ${activeSupplier ? `
            <div class="card" style="padding: 12px 16px; background: #fff; border-radius: var(--radius-lg); border: 1px solid var(--slate-200); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;">
              <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px;">
                <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--slate-400); letter-spacing: 0.05em;">Rate Sheet:</span>
                <span style="font-size: 14px; font-weight: 700; color: var(--slate-900);">${activeSupplier.name}</span>
                ${activeSupplier.city ? `<span class="chip" style="font-size: 11px; background: var(--slate-100); color: var(--slate-700);">📍 ${activeSupplier.city}</span>` : ""}
                ${activeSupplier.phone ? `<span style="font-size: 12px; color: var(--slate-500);">📞 ${activeSupplier.phone}</span>` : ""}
              </div>
              <div style="font-size: 12px; color: var(--slate-500);">
                <b>${allSupplierRates.length}</b> configured rate card${allSupplierRates.length === 1 ? "" : "s"}
              </div>
            </div>
          ` : ""}

          <div class="table-card">
            <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--slate-200); background: var(--slate-50);">
              <div style="width: 280px;">
                <input
                  type="text"
                  class="input"
                  style="width: 100%; font-size: 12px;"
                  placeholder="Filter products or variations…"
                  value="${state.vendorPricingProductSearch || ""}"
                  oninput="window.RS_APP.setVendorPricingProductSearch(this.value)"
                />
              </div>
              <div style="font-size: 12px; color: var(--slate-500);">
                Showing <b>${displayRates.length}</b> of <b>${allSupplierRates.length}</b> rates
              </div>
            </div>

            ${displayRates.length === 0 ? `
              <div style="padding: 48px 16px; text-align: center;">
                <div style="font-size: 15px; font-weight: 600; color: var(--slate-800);">No rate cards found</div>
                <p style="font-size: 12px; color: var(--slate-500); margin: 6px 0 16px;">
                  ${prodSearch ? "No items match your search filter." : `No rate cards configured for ${activeSupplier ? activeSupplier.name : "this supplier"} yet.`}
                </p>
                <button class="btn btn-primary" onclick="window.RS_APP.openAddVendorPriceModal()">+ Add Supplier Rate</button>
              </div>
            ` : `
              <table class="table">
                <thead>
                  <tr>
                    <th>SKU / Variation</th>
                    <th>Supplier</th>
                    <th style="text-align: right;">Agreed Rate</th>
                    <th>Notes &amp; MOQ</th>
                    <th style="text-align: center;">Status</th>
                    <th style="text-align: right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${displayRates.map((vp) => `
                    <tr>
                      <td><code style="font-family: var(--font-mono); font-weight: 600; color: var(--slate-900); font-size: 12px;">${vp.shortName}</code></td>
                      <td style="font-weight: 600; color: var(--slate-900); font-size: 13px;">${vp.supplierName}</td>
                      <td style="font-weight: 700; color: var(--brand-700); text-align: right; font-size: 14px;">${formatMoney(vp.rate)}</td>
                      <td style="color: var(--slate-600); font-size: 12px;">${vp.notes || "—"}</td>
                      <td style="text-align: center;">
                        <span class="chip chip-active" style="font-size: 10px;">Active</span>
                      </td>
                      <td style="text-align: right;">
                        <div style="display: inline-flex; align-items: center; gap: 6px;">
                          <button class="table-action-btn" onclick="window.RS_APP.openVendorPriceHistoryModal('${vp.id}')" title="View price history log">History</button>
                          <button class="table-action-btn" onclick="window.RS_APP.editVendorPrice('${vp.id}')">Update</button>
                        </div>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `}
          </div>
        </div>
      </div>
    `;
  }

  // ------------------------------------------
  // 9. PARTIES DIRECTORY (CUSTOMERS & SUPPLIERS)
  // ------------------------------------------
  function renderPartiesView(container, type) {
    const isSupp = type === "SUPPLIER";
    const parties = state.parties.filter((p) => p.type === type || p.type === "BOTH");

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">${isSupp ? "Suppliers Directory" : "Customers Directory"}</h1>
            <span class="page-subtitle">${parties.length} contacts listed</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="window.RS_APP.openAddPartyModal('${type}')">
              + Add ${isSupp ? "Supplier" : "Customer"}
            </button>
          </div>
        </div>
      </div>

      <div class="table-card">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact Person</th>
              <th>Phone &amp; Email</th>
              <th>City</th>
              ${!isSupp ? "<th>Credit Score</th>" : ""}
              <th>Status</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${parties.map((p) => `
              <tr style="cursor: pointer;" onclick="window.RS_APP.openPartyDetail('${p.id}')">
                <td>
                  <div style="font-weight: 600; color: var(--slate-900);">${p.name}</div>
                  <div style="font-size: 11px; color: var(--slate-500);">${p.address || ""}</div>
                </td>
                <td>${p.contactPerson || "—"}</td>
                <td>
                  <div>${p.phone || "—"}</div>
                  <div style="font-size: 11px; color: var(--slate-400);">${p.email || ""}</div>
                </td>
                <td>${p.city || "—"}</td>
                ${!isSupp ? `<td><span class="chip ${p.creditScore >= 80 ? "chip-active" : p.creditScore >= 60 ? "chip-amber" : "chip-rose"}">${p.creditScore || 0}/100</span></td>` : ""}
                <td><span class="chip ${p.active ? "chip-active" : "chip-rose"}">${p.active ? "Active" : "Inactive"}</span></td>
                <td style="text-align: right;" onclick="event.stopPropagation()">
                  <button class="table-action-btn" onclick="window.RS_APP.openPartyDetail('${p.id}')">Profile</button>
                  <button class="table-action-btn" onclick="window.RS_APP.openEditPartyModal('${p.id}')">Edit</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPartyDetailView(container, partyId) {
    const party = state.parties.find((p) => p.id === partyId);
    if (!party) {
      container.innerHTML = `<div class="card p-6">Party not found.</div>`;
      return;
    }

    const isSupp = party.type === "SUPPLIER";
    const relatedDocs = isSupp 
      ? state.purchases.filter((x) => x.partyId === party.id)
      : state.sales.filter((x) => x.partyId === party.id);

    container.innerHTML = `
      <div class="page-header">
        <button class="back-link" onclick="window.RS_APP.navigate('${isSupp ? "suppliers" : "customers"}')">
          &larr; Back to ${isSupp ? "Suppliers" : "Customers"}
        </button>
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">${party.name}</h1>
            <span class="chip chip-active">${party.type}</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="window.RS_APP.startCartForParty('${party.id}', '${isSupp ? "purchase" : "sale"}')">
              + New ${isSupp ? "Purchase from Supplier" : "Sale to Customer"}
            </button>
          </div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 16px;">
        <div class="card" style="padding: 16px;">
          <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 12px;">Contact Profile</h3>
          <div style="font-size: 13px; margin-bottom: 8px;"><b>Contact Person:</b> ${party.contactPerson || "—"}</div>
          <div style="font-size: 13px; margin-bottom: 8px;"><b>Phone:</b> ${party.phone || "—"}</div>
          <div style="font-size: 13px; margin-bottom: 8px;"><b>Email:</b> ${party.email || "—"}</div>
          <div style="font-size: 13px; margin-bottom: 8px;"><b>City:</b> ${party.city || "—"}</div>
          <div style="font-size: 13px; margin-bottom: 8px;"><b>Billing Address:</b> ${party.address || "—"}</div>
          <div style="font-size: 13px; margin-bottom: 8px;"><b>Shipping Address:</b> ${party.shippingAddress || "Same as billing"}</div>
          ${!isSupp ? `<div style="font-size: 13px; margin-top: 12px;"><b>Credit Score:</b> <span class="chip chip-active">${party.creditScore}/100</span></div>` : ""}
        </div>

        <div class="card" style="padding: 16px;">
          <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 12px;">Transaction History (${relatedDocs.length})</h3>
          <table class="table" style="font-size: 13px;">
            <thead>
              <tr>
                <th>Document #</th>
                <th>Date</th>
                <th>Total</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              ${relatedDocs.map((d) => `
                <tr style="cursor: pointer;" onclick="window.RS_APP.openDocumentDetail('${d.id}', '${isSupp ? "purchase" : "sale"}')">
                  <td style="font-family: var(--font-mono); font-weight: 700; color: var(--brand-700);">${d.number}</td>
                  <td>${formatDate(d.date)}</td>
                  <td style="font-weight: 700;">${formatMoney(d.total)}</td>
                  <td><span class="chip chip-active">${d.paymentStatus}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ------------------------------------------
  // 10. ADMIN & SETTINGS
  // ------------------------------------------
  function renderUsersView(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div class="page-header-titles">
            <h1 class="page-title">User Management</h1>
            <span class="page-subtitle">Configure staff accounts, roles, and permissions</span>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" onclick="window.RS_APP.openAddUserModal()">+ Add Staff User</button>
          </div>
        </div>
      </div>

      <div class="table-card">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${state.users.map((u) => `
              <tr>
                <td style="font-weight: 600; color: var(--slate-900);">${u.name}</td>
                <td>${u.email}</td>
                <td><span class="chip chip-slate">${u.role.replace("_", " ").toUpperCase()}</span></td>
                <td><span class="chip ${u.active ? "chip-active" : "chip-rose"}">${u.active ? "Active" : "Deactivated"}</span></td>
                <td style="text-align: right;">
                  <button class="table-action-btn" onclick="window.RS_APP.toggleUserActive('${u.id}')">${u.active ? "Deactivate" : "Activate"}</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderBackupView(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Backup &amp; Restore</h1>
        <span class="page-subtitle">Export or restore company inventory database snapshots</span>
      </div>

      <div class="card" style="padding: 24px; max-width: 640px;">
        <h3 style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">Download JSON Snapshot</h3>
        <p style="font-size: 13px; color: var(--slate-600); margin-bottom: 16px;">
          Export the entire database including products, stock balances, parties, and transaction invoices.
        </p>
        <button class="btn btn-primary" onclick="window.RS_APP.downloadJsonBackup()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export Database Snapshot
        </button>
      </div>
    `;
  }

  function renderSettingsView(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Company Settings</h1>
        <span class="page-subtitle">${state.company.name}</span>
      </div>

      <div class="card" style="padding: 24px; max-width: 720px;">
        <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">Selling below recorded stock policy</h3>
        <div style="background: var(--brand-50); border: 1px solid var(--brand-200); padding: 14px; border-radius: 6px; font-size: 13px; color: var(--brand-900); margin-bottom: 16px;">
          <b>Active Policy: WARN_AND_ALLOW (Fixed by Architecture)</b>
          <p style="margin-top: 6px;">
            V2 and V3 enforce Warn &amp; Allow for counted stock. Any seller may confirm a sale below zero after a clear shortage warning,
            and each confirmed case is recorded in the audit log. Stock adjustments cannot go below zero; later purchases reconcile a negative balance automatically.
          </p>
        </div>

        <div class="form-group">
          <label class="form-label">Company Name</label>
          <input type="text" class="form-input" value="${state.company.name}" disabled>
        </div>
        <div class="form-group">
          <label class="form-label">Registered GSTIN</label>
          <input type="text" class="form-input" value="${state.company.gstin}" disabled>
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input type="text" class="form-input" value="${state.company.phone}" disabled>
        </div>
      </div>
    `;
  }

  function renderGlossaryView(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">System Glossary &amp; Inventory Terms</h1>
        <span class="page-subtitle">Plain-language dictionary for warehouse and sales staff</span>
      </div>

      <div class="cards-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
        ${state.glossary.map((g) => `
          <div class="card" style="padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <h3 style="font-size: 15px; font-weight: 700; color: var(--slate-900);">${g.term}</h3>
              <span class="chip chip-slate" style="font-size: 10px;">${g.group}</span>
            </div>
            ${g.aka ? `<div style="font-size: 11px; color: var(--slate-400); margin-bottom: 6px;">Aka: ${g.aka}</div>` : ""}
            <p style="font-size: 13px; color: var(--slate-600); margin-top: 6px;">${g.meaning}</p>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderLoginView(container) {
    container.innerHTML = `
      <div style="min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 24px;">
        <div class="card" style="max-width: 400px; width: 100%; padding: 24px;">
          <h2 style="font-size: 20px; font-weight: 700; color: var(--slate-900); margin-bottom: 4px;">RS Machinery</h2>
          <p style="font-size: 13px; color: var(--slate-500); margin-bottom: 18px;">Sign in or quick-switch demo role</p>

          <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
            <button class="btn btn-secondary" onclick="window.RS_APP.setRole('admin')">Sign in as Admin (Rajesh)</button>
            <button class="btn btn-secondary" onclick="window.RS_APP.setRole('sales_manager')">Sign in as Sales Manager (Sunil)</button>
            <button class="btn btn-secondary" onclick="window.RS_APP.setRole('sales_staff')">Sign in as Sales Staff (Amit)</button>
          </div>

          <button class="btn btn-primary" style="width: 100%;" onclick="window.RS_APP.navigate('products')">Continue to Catalog</button>
        </div>
      </div>
    `;
  }

  // ------------------------------------------
  // IMAGE EDITOR & CROP STUDIO VIEW
  // ------------------------------------------
  let imgEditor = {
    image: null,
    imageName: "product-image.jpg",
    dataUrl: null,
    zoom: 0.75,
    rotation: 0,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    cropSize: 320,
    targetProductId: null
  };

  function renderImageEditorView(container) {
    container.innerHTML = `
      <div class="page-header">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
          <div class="page-header-titles">
            <h1 class="page-title">Image Studio &amp; Cropper</h1>
            <span class="page-subtitle">Crop 1:1 square photos, zoom out freely, and pad blank space with studio white (<code style="font-family: var(--font-mono); color: var(--brand-700);">#ffffff</code>)</span>
          </div>
          <div class="page-actions" style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" onclick="window.RS_APP.loadSampleImageEditor()">
              Load Sample Image
            </button>
            <label class="btn btn-primary" style="cursor: pointer; margin: 0;">
              <span>Select File…</span>
              <input type="file" accept="image/*" style="display: none;" onchange="window.RS_APP.loadImageEditorFile(event)">
            </label>
          </div>
        </div>
      </div>

      ${!imgEditor.image ? `
        <div class="cropper-dropzone" id="img-dropzone"
          ondragover="event.preventDefault(); this.classList.add('dragover');"
          ondragleave="this.classList.remove('dragover');"
          ondrop="window.RS_APP.handleImageDrop(event);"
          onclick="document.getElementById('hidden-file-input').click();">
          <input type="file" id="hidden-file-input" accept="image/*" style="display: none;" onchange="window.RS_APP.loadImageEditorFile(event)">
          <div style="width: 54px; height: 54px; border-radius: 50%; background: var(--slate-100); color: var(--slate-500); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </div>
          <h3 style="font-size: 16px; font-weight: 700; color: var(--slate-800); margin-bottom: 6px;">Drop product image here or click to browse</h3>
          <p style="font-size: 13px; color: var(--slate-500); max-width: 440px; margin: 0 auto 16px;">
            Supports JPEG, PNG, WebP. Full zoom out capability with automated pure white padding for eCommerce / catalog thumbnails.
          </p>
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button type="button" class="btn btn-primary" onclick="event.stopPropagation(); document.getElementById('hidden-file-input').click();">Select Image File</button>
            <button type="button" class="btn btn-secondary" onclick="event.stopPropagation(); window.RS_APP.loadSampleImageEditor();">Test with Sample</button>
          </div>
        </div>
      ` : `
        <div style="display: grid; grid-template-columns: minmax(360px, 1.4fr) minmax(280px, 1fr); gap: 20px;">
          <!-- Left Column: Interactive Canvas Stage & Controls -->
          <div class="card" style="padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--slate-100); padding-bottom: 8px;">
              <div>
                <h3 style="font-size: 14px; font-weight: 700; color: var(--slate-800);">Interactive Square Cropper</h3>
                <span style="font-size: 11px; color: var(--slate-500);">Drag image inside frame. Zoom out below 100% to create studio white padding.</span>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="imgEditor.image = null; renderCurrentRoute();">Change Photo</button>
            </div>

            <!-- Canvas Stage Container -->
            <div class="cropper-stage" id="cropper-stage-wrap">
              <canvas id="crop-stage-canvas" width="400" height="400" style="width: 400px; height: 400px; display: block;"></canvas>
            </div>

            <!-- Controls Toolbar -->
            <div style="margin-top: 14px; padding: 12px; background: var(--slate-50); border: 1px solid var(--slate-200); border-radius: var(--radius-md);">
              <!-- Zoom Row -->
              <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--slate-700);">
                  <span>Zoom:</span>
                  <button type="button" class="zoom-btn" onclick="window.RS_APP.stepImgEditorZoom(-0.1)" title="Zoom Out (Adds pure white margin)">−</button>
                  <input type="range" id="cropper-zoom-range" min="0.2" max="3" step="0.05" value="${imgEditor.zoom}" style="width: 130px; accent-color: var(--brand-600);" oninput="window.RS_APP.setImgEditorZoom(Number(this.value))">
                  <button type="button" class="zoom-btn" onclick="window.RS_APP.stepImgEditorZoom(0.1)" title="Zoom In">+</button>
                  <span id="zoom-readout" style="font-family: var(--font-mono); font-size: 11px; color: var(--slate-600); width: 44px; text-align: right;">${Math.round(imgEditor.zoom * 100)}%</span>
                </div>

                <!-- Quick Presets -->
                <div style="display: flex; gap: 4px;">
                  <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; ${imgEditor.zoom === 0.5 ? 'background: var(--brand-600); color: white;' : ''}" onclick="window.RS_APP.setImgEditorZoom(0.5)">50%</button>
                  <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; ${imgEditor.zoom === 0.75 ? 'background: var(--brand-600); color: white;' : ''}" onclick="window.RS_APP.setImgEditorZoom(0.75)">75%</button>
                  <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 8px; ${imgEditor.zoom === 1 ? 'background: var(--brand-600); color: white;' : ''}" onclick="window.RS_APP.setImgEditorZoom(1)">100% Fit</button>
                </div>
              </div>

              <!-- Rotate & Reset Row -->
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--slate-200); padding-top: 8px;">
                <div style="display: flex; gap: 6px;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.RS_APP.rotateImgEditor(-90)" title="Rotate Counter-Clockwise">↺ 90° Left</button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.RS_APP.rotateImgEditor(90)" title="Rotate Clockwise">↻ 90° Right</button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.RS_APP.resetImgEditor()" title="Reset Position and Zoom">Reset</button>
                </div>
                <span style="font-size: 11px; color: var(--slate-500);">Scroll mouse wheel to zoom</span>
              </div>
            </div>
          </div>

          <!-- Right Column: Live Result Preview & Actions -->
          <div class="card" style="padding: 16px; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="border-bottom: 1px solid var(--slate-100); padding-bottom: 8px; margin-bottom: 14px;">
                <h3 style="font-size: 14px; font-weight: 700; color: var(--slate-800);">Cropped Output Preview</h3>
                <span style="font-size: 11px; color: var(--slate-500);">Rendered 1:1 square JPEG with studio white (#ffffff) borders</span>
              </div>

              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 16px 0;">
                <div class="cropper-preview-frame">
                  <canvas id="crop-preview-canvas" width="240" height="240" style="width: 240px; height: 240px; display: block;"></canvas>
                </div>
                <div style="margin-top: 8px; font-size: 11px; font-family: var(--font-mono); color: var(--slate-500);">
                  Output: 1:1 Square JPEG · Pure White Background
                </div>
              </div>

              <div style="background: var(--slate-50); border: 1px solid var(--slate-200); border-radius: var(--radius-md); padding: 10px 14px; font-size: 12px; color: var(--slate-600); margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="color: var(--slate-500);">Format:</span>
                  <span style="font-weight: 600;">JPEG (0.92 Quality)</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="color: var(--slate-500);">Aspect Ratio:</span>
                  <span style="font-weight: 600;">1:1 Square</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span style="color: var(--slate-500);">Blank Margin Fill:</span>
                  <span style="font-weight: 700; color: var(--brand-700);">Pure White (#ffffff)</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: var(--slate-500);">Target Resolution:</span>
                  <span style="font-family: var(--font-mono); font-weight: 600;">1200 × 1200 px</span>
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 14px;">
                <label class="form-label">Assign to Catalog Product</label>
                <select id="crop-assign-product" class="form-input">
                  <option value="">-- Save as standalone upload --</option>
                  ${state.products.map((p) => `<option value="${p.id}">${p.name} (${p.baseShortName})</option>`).join("")}
                </select>
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--slate-100); padding-top: 14px;">
              <button class="btn btn-primary" style="width: 100%;" onclick="window.RS_APP.saveCroppedToCatalog()">
                Upload &amp; Save to Catalog
              </button>
              <button class="btn btn-secondary" style="width: 100%;" onclick="window.RS_APP.downloadCroppedImage()">
                Download JPEG to Computer
              </button>
            </div>
          </div>
        </div>
      `}
    `;

    if (imgEditor.image) {
      setTimeout(() => initCropperCanvasEvents(), 50);
    }
  }

  function initCropperCanvasEvents() {
    const canvas = document.getElementById("crop-stage-canvas");
    if (!canvas) return;

    redrawCropperStage();

    canvas.onmousedown = (e) => {
      imgEditor.isDragging = true;
      imgEditor.dragStartX = e.clientX - imgEditor.panX;
      imgEditor.dragStartY = e.clientY - imgEditor.panY;
    };

    window.onmousemove = (e) => {
      if (!imgEditor.isDragging) return;
      imgEditor.panX = e.clientX - imgEditor.dragStartX;
      imgEditor.panY = e.clientY - imgEditor.dragStartY;
      redrawCropperStage();
    };

    window.onmouseup = () => {
      imgEditor.isDragging = false;
    };

    canvas.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      imgEditor.zoom = Math.max(0.2, Math.min(3, Number((imgEditor.zoom + delta).toFixed(2))));
      const range = document.getElementById("cropper-zoom-range");
      if (range) range.value = imgEditor.zoom;
      const readout = document.getElementById("zoom-readout");
      if (readout) readout.textContent = Math.round(imgEditor.zoom * 100) + "%";
      redrawCropperStage();
    };
  }

  function redrawCropperStage() {
    const canvas = document.getElementById("crop-stage-canvas");
    if (!canvas || !imgEditor.image) return;
    const ctx = canvas.getContext("2d");
    const cw = canvas.width;
    const ch = canvas.height;

    // 1. Fill entire canvas with pure white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);

    // 2. Draw image rotated, translated, and scaled
    ctx.save();
    ctx.translate(cw / 2 + imgEditor.panX, ch / 2 + imgEditor.panY);
    ctx.rotate((imgEditor.rotation * Math.PI) / 180);
    const imgW = imgEditor.image.naturalWidth || imgEditor.image.width;
    const imgH = imgEditor.image.naturalHeight || imgEditor.image.height;
    const baseScale = Math.min(imgEditor.cropSize / imgW, imgEditor.cropSize / imgH);
    const scale = baseScale * imgEditor.zoom;
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    ctx.drawImage(imgEditor.image, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // 3. Draw crop frame & soft dark overlay outside the square crop boundary
    const cropX = (cw - imgEditor.cropSize) / 2;
    const cropY = (ch - imgEditor.cropSize) / 2;

    ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
    ctx.fillRect(0, 0, cw, cropY); // top
    ctx.fillRect(0, cropY + imgEditor.cropSize, cw, ch - (cropY + imgEditor.cropSize)); // bottom
    ctx.fillRect(0, cropY, cropX, imgEditor.cropSize); // left
    ctx.fillRect(cropX + imgEditor.cropSize, cropY, cw - (cropX + imgEditor.cropSize), imgEditor.cropSize); // right

    ctx.strokeStyle = "#ea580c";
    ctx.lineWidth = 2;
    ctx.strokeRect(cropX, cropY, imgEditor.cropSize, imgEditor.cropSize);

    // Update preview canvas
    redrawCropperPreview();
  }

  function redrawCropperPreview() {
    const pCanvas = document.getElementById("crop-preview-canvas");
    if (!pCanvas || !imgEditor.image) return;
    const pCtx = pCanvas.getContext("2d");
    const size = pCanvas.width;

    // Solid pure white background
    pCtx.fillStyle = "#ffffff";
    pCtx.fillRect(0, 0, size, size);

    pCtx.save();
    const ratio = size / imgEditor.cropSize;
    pCtx.translate(size / 2 + imgEditor.panX * ratio, size / 2 + imgEditor.panY * ratio);
    pCtx.rotate((imgEditor.rotation * Math.PI) / 180);
    const imgW = imgEditor.image.naturalWidth || imgEditor.image.width;
    const imgH = imgEditor.image.naturalHeight || imgEditor.image.height;
    const baseScale = Math.min(imgEditor.cropSize / imgW, imgEditor.cropSize / imgH);
    const scale = baseScale * imgEditor.zoom * ratio;
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    pCtx.drawImage(imgEditor.image, -drawW / 2, -drawH / 2, drawW, drawH);
    pCtx.restore();
  }

  function getFullResCroppedDataUrl() {
    const exp = document.createElement("canvas");
    exp.width = 1200;
    exp.height = 1200;
    const ctx = exp.getContext("2d");

    // Pure white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1200, 1200);

    const ratio = 1200 / imgEditor.cropSize;
    ctx.save();
    ctx.translate(600 + imgEditor.panX * ratio, 600 + imgEditor.panY * ratio);
    ctx.rotate((imgEditor.rotation * Math.PI) / 180);
    const imgW = imgEditor.image.naturalWidth || imgEditor.image.width;
    const imgH = imgEditor.image.naturalHeight || imgEditor.image.height;
    const baseScale = Math.min(imgEditor.cropSize / imgW, imgEditor.cropSize / imgH);
    const scale = baseScale * imgEditor.zoom * ratio;
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    ctx.drawImage(imgEditor.image, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    return exp.toDataURL("image/jpeg", 0.92);
  }

  function downloadCroppedImage() {
    if (!imgEditor.image) return;
    const dataUrl = getFullResCroppedDataUrl();
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = (imgEditor.imageName || "product").replace(/\.[^/.]+$/, "") + "-square.jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Downloaded cropped JPEG with studio white background!");
  }

  function saveCroppedToCatalog() {
    if (!imgEditor.image) return;
    const dataUrl = getFullResCroppedDataUrl();
    const prodSelect = document.getElementById("crop-assign-product");
    const prodId = prodSelect ? prodSelect.value : (imgEditor.targetProductId || null);

    if (prodId) {
      if (prodId === "new") {
        builderState.imageUrl = dataUrl;
        showToast("Assigned cropped photo to new product being created!");
        renderProductModal();
        return;
      }
      const p = state.products.find((x) => x.id === prodId);
      if (p) {
        p.imageUrl = dataUrl;
        if (builderState && builderState.productId === prodId) {
          builderState.imageUrl = dataUrl;
        }
        showToast(`Assigned cropped photo to "${p.name}" with white padding!`);
        return;
      }
    }
    showToast("Uploaded image to catalog storage (/api/images/img_" + Date.now() + ")");
  }

  function loadSampleImageEditor() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
      <defs>
        <linearGradient id="sample_g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ea580c"/>
          <stop offset="100%" stop-color="#9a3412"/>
        </linearGradient>
      </defs>
      <rect width="600" height="400" fill="#f8fafc"/>
      <rect x="80" y="60" width="440" height="280" rx="16" fill="url(#sample_g)"/>
      <circle cx="300" cy="200" r="70" fill="#ffffff" opacity="0.95"/>
      <text x="300" y="208" font-family="sans-serif" font-size="28" font-weight="bold" fill="#ea580c" text-anchor="middle">RS MACHINE</text>
      <text x="300" y="370" font-family="sans-serif" font-size="16" font-weight="600" fill="#64748b" text-anchor="middle">Wide Aspect Sample Product (600×400)</text>
    </svg>`;
    const img = new Image();
    img.onload = () => {
      imgEditor.image = img;
      imgEditor.imageName = "sample-product.jpg";
      imgEditor.zoom = 0.75;
      imgEditor.rotation = 0;
      imgEditor.panX = 0;
      imgEditor.panY = 0;
      renderCurrentRoute();
      showToast("Loaded sample wide image. Zoomed out with white borders.");
    };
    imgEditor.dataUrl = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    img.src = imgEditor.dataUrl;
  }

  function loadImageEditorFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    processImageFile(file);
    e.target.value = "";
  }

  function handleImageDrop(e) {
    e.preventDefault();
    const el = document.getElementById("img-dropzone");
    if (el) el.classList.remove("dragover");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) processImageFile(file);
  }

  function processImageFile(file) {
    if (!file.type.startsWith("image/")) {
      showToast("Please choose a valid image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        imgEditor.image = img;
        imgEditor.imageName = file.name;
        imgEditor.zoom = 0.85;
        imgEditor.rotation = 0;
        imgEditor.panX = 0;
        imgEditor.panY = 0;
        renderCurrentRoute();
        showToast(`Loaded "${file.name}" into image cropper`);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ==========================================
  // MODALS & DRAWERS IMPLEMENTATION
  // ==========================================

  function openProductDetailModal(productId) {
    const product = state.products.find((p) => p.id === productId);
    if (!product) return;

    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-overlay" onclick="window.RS_APP.closeModals()">
        <div class="modal-content wide" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div>
              <div class="modal-title">${product.name}</div>
              <div style="font-size: 12px; color: var(--slate-500); font-family: var(--font-mono);">${product.baseShortName} · ${product.categoryName}</div>
            </div>
            <button class="modal-close" onclick="window.RS_APP.closeModals()">&times;</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom: 16px; font-size: 13px; color: var(--slate-600);">${product.description || "No description provided."}</div>
            <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">Variations List (${product.variations.length})</h4>
            <table class="table" style="font-size: 12px;">
              <thead>
                <tr style="background: var(--slate-100);">
                  <th>Short Name</th>
                  <th>Stock</th>
                  <th>Min Price</th>
                  <th>Selling Price</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                ${product.variations.map((v) => `
                  <tr>
                    <td><code style="font-family: var(--font-mono); font-weight: 600;">${v.shortName}</code></td>
                    <td style="font-weight: 600;">${v.stock} ${product.unit}s</td>
                    <td>${formatMoney(v.minSalePrice)}</td>
                    <td style="font-weight: 700; color: var(--brand-700);">${formatMoney(v.salePrice)}</td>
                    <td>${formatMoney(v.purchaseCost)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.RS_APP.closeModals()">Close</button>
            <button class="btn btn-primary" onclick="window.RS_APP.openEditProductModal('${product.id}')">Edit Product</button>
          </div>
        </div>
      </div>
    `;
  }

  function openStockAdjustModal(productId) {
    const product = state.products.find((p) => p.id === productId);
    if (!product) return;

    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-overlay" onclick="window.RS_APP.closeModals()">
        <div class="modal-content" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div class="modal-title">Manual Stock Adjustment - ${product.name}</div>
            <button class="modal-close" onclick="window.RS_APP.closeModals()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Select Variation</label>
              <select id="adjust-var-id" class="form-input">
                ${product.variations.map((v) => `<option value="${v.id}">${v.shortName} (Current: ${v.stock} ${product.unit}s)</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Adjustment Type</label>
              <select id="adjust-type" class="form-input">
                <option value="ADD">Add Stock (+)</option>
                <option value="REDUCE">Reduce Stock (−)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Adjustment Quantity</label>
              <input type="number" id="adjust-qty" class="form-input" min="1" value="10">
            </div>
            <div class="form-group">
              <label class="form-label">Reason</label>
              <select id="adjust-reason" class="form-input">
                <option value="Manual Count Correction">Manual Count Correction</option>
                <option value="Damage / Loss">Damage / Loss</option>
                <option value="Found in Godown">Found in Godown</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.RS_APP.closeModals()">Cancel</button>
            <button class="btn btn-primary" onclick="window.RS_APP.commitStockAdjustment()">Save Adjustment</button>
          </div>
        </div>
      </div>
    `;
  }

  function commitStockAdjustment() {
    const varId = document.getElementById("adjust-var-id").value;
    const type = document.getElementById("adjust-type").value;
    const qty = Number(document.getElementById("adjust-qty").value) || 0;
    const reason = document.getElementById("adjust-reason").value;

    state.products.forEach((p) => {
      const v = p.variations.find((x) => x.id === varId);
      if (v) {
        if (type === "ADD") v.stock += qty;
        else v.stock -= qty;
      }
    });

    closeModals();
    renderCurrentRoute();
    showToast(`Stock adjusted (${type === "ADD" ? `+${qty}` : `−${qty}`}) for ${reason}`);
  }

  function openPartySelectDrawer(mode) {
    const drawerRoot = document.getElementById("drawer-root");
    const isSale = mode === "sale";
    const parties = state.parties.filter((p) => isSale ? (p.type === "CUSTOMER" || p.type === "BOTH") : (p.type === "SUPPLIER" || p.type === "BOTH"));

    drawerRoot.innerHTML = `
      <div class="drawer-overlay" onclick="window.RS_APP.closeDrawers()"></div>
      <div class="drawer-bottom">
        <div class="drawer-header">
          <div>
            <h3 style="font-size: 15px; font-weight: 700;">Select ${isSale ? "Customer" : "Supplier"}</h3>
            <p style="font-size: 12px; color: var(--slate-500);">Choose an existing account or walk-in</p>
          </div>
          <button class="modal-close" onclick="window.RS_APP.closeDrawers()">&times;</button>
        </div>
        <div style="padding: 18px; max-height: 60vh; overflow-y: auto;">
          ${isSale ? `
            <div style="padding: 12px; border: 1px solid var(--slate-200); border-radius: 8px; margin-bottom: 12px; cursor: pointer; background: var(--slate-50);" onclick="window.RS_APP.selectParty(null)">
              <div style="font-weight: 700; font-size: 14px;">Walk-in Customer</div>
              <div style="font-size: 12px; color: var(--slate-500);">Direct OTC sale without saved customer profile</div>
            </div>
          ` : ""}

          ${parties.map((p) => `
            <div style="padding: 12px; border: 1px solid var(--slate-200); border-radius: 8px; margin-bottom: 8px; cursor: pointer; transition: background 0.15s;" onclick="window.RS_APP.selectParty('${p.id}')">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 700; font-size: 14px; color: var(--slate-900);">${p.name}</div>
                ${p.creditScore ? `<span class="chip chip-active">Score: ${p.creditScore}</span>` : ""}
              </div>
              <div style="font-size: 12px; color: var(--slate-500); margin-top: 2px;">
                ${p.phone ? `Phone: ${p.phone} · ` : ""}${p.city || ""}
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function selectParty(partyId) {
    if (!partyId) {
      state.cart.party = null;
    } else {
      const p = state.parties.find((x) => x.id === partyId);
      state.cart.party = p || null;
    }
    closeDrawers();
    renderCurrentRoute();
    showToast(state.cart.party ? `Selected ${state.cart.party.name}` : "Selected Walk-in Customer");
  }

  function openProductCartDrawer(productId, mode) {
    const product = state.products.find((p) => p.id === productId);
    if (!product) return;

    const activeVars = getActiveVariations(product);
    if (activeVars.length === 0) return;

    const drawerRoot = document.getElementById("drawer-root");
    const isSale = mode === "sale";

    drawerRoot.innerHTML = `
      <div class="drawer-overlay" onclick="window.RS_APP.closeDrawers()"></div>
      <div class="drawer-bottom">
        <div class="drawer-header">
          <div>
            <h3 style="font-size: 15px; font-weight: 700;">${product.name}</h3>
            <p style="font-size: 12px; color: var(--slate-500); font-family: var(--font-mono);">${product.baseShortName} · Choose Variation</p>
          </div>
          <button class="modal-close" onclick="window.RS_APP.closeDrawers()">&times;</button>
        </div>

        <div style="padding: 18px; max-height: 65vh; overflow-y: auto;">
          <div class="form-group">
            <label class="form-label">Select SKU / Variation</label>
            <select id="cart-drawer-variation" class="form-input" onchange="window.RS_APP.handleDrawerVariationChange('${product.id}', this.value, '${mode}')">
              ${activeVars.map((v) => `
                <option value="${v.id}">${v.shortName} (Stock: ${v.stock} ${product.unit}s | Selling: ${formatMoney(v.salePrice)})</option>
              `).join("")}
            </select>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="form-group">
              <label class="form-label">Quantity (${product.unit}s)</label>
              <input type="number" id="cart-drawer-qty" class="form-input" min="1" value="1" oninput="window.RS_APP.calculateDrawerLineTotal()">
            </div>
            <div class="form-group">
              <label class="form-label">Unit Rate (₹)</label>
              <input type="number" id="cart-drawer-price" class="form-input" value="${activeVars[0].salePrice}" oninput="window.RS_APP.calculateDrawerLineTotal()">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Line Discount (Flat ₹)</label>
            <input type="number" id="cart-drawer-discount" class="form-input" value="0" oninput="window.RS_APP.calculateDrawerLineTotal()">
          </div>

          <div style="background: var(--slate-50); border: 1px solid var(--slate-200); border-radius: 8px; padding: 12px; margin-top: 14px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 600;">Computed Line Total:</span>
            <span id="cart-drawer-total" style="font-size: 18px; font-weight: 800; color: var(--brand-700);">${formatMoney(activeVars[0].salePrice)}</span>
          </div>

          <button class="btn btn-primary" style="width: 100%; margin-top: 16px; padding: 10px;" onclick="window.RS_APP.commitAddDrawerToCart('${product.id}', '${mode}')">
            Add to Cart
          </button>
        </div>
      </div>
    `;
  }

  function handleDrawerVariationChange(productId, varId, mode) {
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    const v = p.variations.find((x) => x.id === varId);
    if (!v) return;
    const priceInput = document.getElementById("cart-drawer-price");
    if (priceInput) priceInput.value = mode === "sale" ? v.salePrice : v.purchaseCost;
    calculateDrawerLineTotal();
  }

  function calculateDrawerLineTotal() {
    const qty = Number(document.getElementById("cart-drawer-qty")?.value) || 0;
    const price = Number(document.getElementById("cart-drawer-price")?.value) || 0;
    const disc = Number(document.getElementById("cart-drawer-discount")?.value) || 0;
    const total = Math.max(0, (qty * price) - disc);
    const totalEl = document.getElementById("cart-drawer-total");
    if (totalEl) totalEl.textContent = formatMoney(total);
  }

  function commitAddDrawerToCart(productId, mode) {
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    const varId = document.getElementById("cart-drawer-variation").value;
    const v = p.variations.find((x) => x.id === varId);
    if (!v) return;

    const qty = Number(document.getElementById("cart-drawer-qty").value) || 1;
    const price = Number(document.getElementById("cart-drawer-price").value) || 0;
    const disc = Number(document.getElementById("cart-drawer-discount").value) || 0;
    const lineTotal = Math.max(0, (qty * price) - disc);

    state.cart.lines.push({
      lineId: "line_" + Date.now(),
      variationId: v.id,
      productName: p.name,
      shortName: v.shortName,
      attributes: v.attributes,
      unit: p.unit,
      quantity: qty,
      price: price,
      discount: disc,
      lineTotal: lineTotal
    });

    closeDrawers();
    updateCartPill();
    renderCurrentRoute();
    showToast(`Added ${v.shortName} to cart`);
  }

  // ------------------------------------------
  // CHECKOUT COMMIT & ORDER GENERATION
  // ------------------------------------------
  function commitCheckout() {
    if (state.cart.lines.length === 0) {
      alert("Cart is empty.");
      return;
    }

    const isSale = state.cart.mode === "sale";
    const totals = calculateCartTotals();
    const payMode = document.getElementById("checkout-payment-mode")?.value || "BANK_TRANSFER";
    const amountPaid = Number(document.getElementById("checkout-amount-paid")?.value) || totals.grandTotal;
    const notes = document.getElementById("checkout-notes")?.value || "";

    const docNumber = (isSale ? "SAL/2026-27/" : "PUR/2026-27/") + String(Date.now()).slice(-4);
    const newDoc = {
      id: "doc_" + Date.now(),
      number: docNumber,
      date: new Date().toISOString(),
      partyId: state.cart.party ? state.cart.party.id : null,
      partyName: state.cart.party ? state.cart.party.name : (isSale ? "Walk-in Customer" : "Direct Supplier"),
      subtotal: totals.subtotal,
      discount: totals.discountTotal,
      total: totals.grandTotal,
      paymentMode: payMode,
      paymentStatus: amountPaid >= totals.grandTotal ? "PAID" : amountPaid > 0 ? "PARTIAL" : "PENDING",
      amountPaid: amountPaid,
      status: "COMPLETED",
      notes: notes,
      lines: state.cart.lines.map((l, i) => ({
        lineNo: i + 1,
        variationId: l.variationId,
        productName: l.productName,
        shortName: l.shortName,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.price,
        unitCost: l.price,
        discount: l.discount,
        lineTotal: l.lineTotal
      }))
    };

    // Stock deduction / increment
    state.cart.lines.forEach((line) => {
      state.products.forEach((p) => {
        const v = p.variations.find((x) => x.id === line.variationId);
        if (v) {
          if (isSale) v.stock -= line.quantity;
          else v.stock += line.quantity;
        }
      });
    });

    if (isSale) state.sales.unshift(newDoc);
    else state.purchases.unshift(newDoc);

    state.cart.lines = [];
    updateCartPill();
    navigate(isSale ? "sale-document" : "purchase-document", { id: newDoc.id });
    showToast(`Document ${newDoc.number} completed successfully!`);
  }

  function saveAsOrder() {
    if (state.cart.lines.length === 0) return;
    const isSale = state.cart.mode === "sale";
    const totals = calculateCartTotals();
    const orderNum = (isSale ? "SO/2026-27/" : "PO/2026-27/") + String(Date.now()).slice(-4);

    const newOrder = {
      id: "ord_" + Date.now(),
      number: orderNum,
      kind: isSale ? "SALE" : "PURCHASE",
      orderDate: new Date().toISOString(),
      expectedDate: new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0],
      status: "PLACED",
      partyId: state.cart.party ? state.cart.party.id : null,
      partyName: state.cart.party ? state.cart.party.name : (isSale ? "Walk-in Customer" : "Direct Supplier"),
      deliveryAddress: "Standard Godown",
      total: totals.grandTotal,
      lineCount: state.cart.lines.length,
      lines: state.cart.lines.map((l, i) => ({
        lineNo: i + 1,
        variationId: l.variationId,
        productName: l.productName,
        shortName: l.shortName,
        unit: l.unit,
        quantity: l.quantity,
        fulfilledQuantity: 0,
        outstandingQuantity: l.quantity,
        price: l.price,
        discount: l.discount,
        lineTotal: l.lineTotal
      })),
      events: [
        { status: "PLACED", note: "Order placed from cart", at: new Date().toISOString(), by: state.currentUser.name }
      ]
    };

    if (isSale) state.saleOrders.unshift(newOrder);
    else state.purchaseOrders.unshift(newOrder);

    state.cart.lines = [];
    updateCartPill();
    navigate(isSale ? "sales-orders" : "purchases-orders");
    showToast(`Order ${newOrder.number} saved!`);
  }

  function holdCart() {
    if (state.cart.lines.length === 0) return;
    const title = prompt("Enter draft title:", "Parked cart - " + new Date().toLocaleTimeString());
    if (!title) return;

    state.drafts.push({
      id: "draft_" + Date.now(),
      title: title,
      mode: state.cart.mode,
      partyId: state.cart.party ? state.cart.party.id : null,
      partyName: state.cart.party ? state.cart.party.name : "Walk-in",
      lineCount: state.cart.lines.length,
      estimatedTotal: calculateCartTotals().grandTotal,
      updatedAt: new Date().toISOString()
    });

    state.cart.lines = [];
    updateCartPill();
    navigate(state.cart.mode === "sale" ? "sales-new" : "purchases-new");
    showToast("Cart held as draft");
  }

  // ------------------------------------------
  // STOCK IN EDITS CONTROLLER
  // ------------------------------------------
  function handleStockInEdit(varId, field, val) {
    if (!state.stockInEdits[varId]) {
      state.stockInEdits[varId] = {};
    }
    state.stockInEdits[varId][field] = val;
    renderCurrentRoute();
  }

  function commitStockIn() {
    const editsCount = Object.keys(state.stockInEdits).length;
    if (editsCount === 0) {
      showToast("No stock changes to commit.");
      return;
    }

    Object.entries(state.stockInEdits).forEach(([varId, changes]) => {
      state.products.forEach((p) => {
        const v = p.variations.find((x) => x.id === varId);
        if (v) {
          if (changes.newStock !== undefined) v.stock = Number(changes.newStock);
          if (changes.salePrice !== undefined) v.salePrice = Number(changes.salePrice);
          if (changes.minSalePrice !== undefined) v.minSalePrice = Number(changes.minSalePrice);
          if (changes.minStock !== undefined) v.lowStockThreshold = Number(changes.minStock);
        }
      });
    });

    state.stockInEdits = {};
    renderCurrentRoute();
    showToast(`Committed bulk stock updates for ${editsCount} variation(s)!`);
  }

  function resetStockInEdits() {
    state.stockInEdits = {};
    renderCurrentRoute();
    showToast("Cleared pending stock edits");
  }

  // Export CSV simulation
  function exportCsv() {
    let csv = "Product Name,Base Code,Category,Unit,Variation SKU,Stock,Sale Price,Cost Price\n";
    state.products.forEach((p) => {
      p.variations.forEach((v) => {
        csv += `"${p.name}","${p.baseShortName}","${p.categoryName}","${p.unit}","${v.shortName}",${v.stock},${v.salePrice},${v.purchaseCost}\n`;
      });
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `RS_Inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    showToast("Exported Inventory CSV");
  }

  function downloadJsonBackup() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const dlAnchorElem = document.createElement("a");
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `RS_Machinery_V3_Backup_${Date.now()}.json`);
    dlAnchorElem.click();
    showToast("Downloaded database backup snapshot JSON");
  }

  // Role switching
  function openRoleSwitcher() {
    const role = prompt("Switch role for testing (admin, sales_manager, sales_staff):", state.currentUser.role);
    if (role && ["admin", "sales_manager", "sales_staff"].includes(role)) {
      setRole(role);
    }
  }

  function setRole(role) {
    state.currentUser.role = role;
    const user = state.users.find((u) => u.role === role) || state.users[0];
    state.currentUser.name = user.name;
    state.currentUser.email = user.email;

    document.getElementById("user-display-name").textContent = user.name;
    document.getElementById("user-display-role").textContent = role.replace("_", " ");
    document.getElementById("user-avatar").textContent = user.name[0];
    document.getElementById("banner-role-indicator").innerHTML = `Viewing as: <b>${role.toUpperCase()} (${user.name})</b>`;

    showToast(`Role switched to ${role.toUpperCase()}`);
    renderCurrentRoute();
  }

  // ------------------------------------------
  // PRODUCT CREATION / EDIT MODAL (4-STEP BUILDER)
  // ------------------------------------------
  let builderState = {
    step: 1,
    isEdit: false,
    productId: null,
    type: "variable",
    name: "",
    baseShortName: "",
    categoryId: "cat_ropes",
    unit: "Piece",
    description: "",
    attributes: [
      { name: "Size", unit: "mm", values: ["10mm", "12mm"], abbrMap: { "10mm": "10", "12mm": "12" } },
      { name: "Brand", unit: "", values: ["Crossbee", "Halfen"], abbrMap: { "Crossbee": "CB", "Halfen": "HF" } }
    ],
    variations: []
  };

  function openAddProductModal() {
    builderState = {
      step: 1,
      isEdit: false,
      productId: null,
      type: "variable",
      name: "",
      baseShortName: "",
      categoryId: state.categories[0]?.id || "cat_ropes",
      unit: "Piece",
      description: "",
      imageUrl: null,
      attributes: [
        { name: "Size", unit: "mm", values: ["8mm", "10mm"], abbrMap: { "8mm": "8", "10mm": "10" } },
        { name: "Brand", unit: "", values: ["Crossbee", "Halfen"], abbrMap: { "Crossbee": "CB", "Halfen": "HF" } }
      ],
      variations: []
    };
    renderProductModal();
  }

  function openEditProductModal(productId) {
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    builderState = {
      step: 1,
      isEdit: true,
      productId: p.id,
      type: p.productType,
      name: p.name,
      baseShortName: p.baseShortName,
      categoryId: p.categoryId,
      unit: p.unit,
      description: p.description || "",
      imageUrl: p.imageUrl || null,
      attributes: (p.attributes || []).map((a) => {
        const copy = JSON.parse(JSON.stringify(a));
        if (copy.isQuality || copy.name.toLowerCase() === "quality") {
          copy.isQuality = true;
          copy.unit = "";
          if (!copy.stars || !copy.stars.length) {
            copy.stars = (copy.values || []).map(Number).filter(Boolean);
            if (!copy.stars.length) copy.stars = [3, 4, 5];
          }
          copy.values = copy.stars.slice().sort((x, y) => x - y).map(String);
        }
        return copy;
      }),
      variations: JSON.parse(JSON.stringify(p.variations || []))
    };
    renderProductModal();
  }

  function renderProductModal() {
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-overlay" onclick="window.RS_APP.closeModals()">
        <div class="modal-content xl" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div>
              <div class="modal-title">${builderState.isEdit ? "Edit Product" : "Add New Product"}</div>
              <div style="font-size: 11px; color: var(--slate-500);">Four-step variation builder parity with main v2 &amp; marble 2110</div>
            </div>
            <button class="modal-close" onclick="window.RS_APP.closeModals()">&times;</button>
          </div>

          <div class="modal-body">
            <!-- Stepper Bar -->
            <div class="stepper">
              <div class="step-item ${builderState.step === 1 ? "active" : ""}" onclick="window.RS_APP.setBuilderStep(1)">
                <span class="step-num">1</span>
                <span>Define Attributes</span>
              </div>
              <div style="color: var(--slate-300);">&rarr;</div>
              <div class="step-item ${builderState.step === 2 ? "active" : ""}" onclick="window.RS_APP.setBuilderStep(2)">
                <span class="step-num">2</span>
                <span>Data &amp; Abbr</span>
              </div>
              <div style="color: var(--slate-300);">&rarr;</div>
              <div class="step-item ${builderState.step === 3 ? "active" : ""}" onclick="window.RS_APP.setBuilderStep(3)">
                <span class="step-num">3</span>
                <span>Generate SKUs</span>
              </div>
              <div style="color: var(--slate-300);">&rarr;</div>
              <div class="step-item ${builderState.step === 4 ? "active" : ""}" onclick="window.RS_APP.setBuilderStep(4)">
                <span class="step-num">4</span>
                <span>Pricing &amp; Stock</span>
              </div>
            </div>

            <!-- Step 1: Definition -->
            ${builderState.step === 1 ? `
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                <div class="form-group">
                  <label class="form-label">Product Name</label>
                  <input type="text" class="form-input" id="b-name" value="${builderState.name}" placeholder="e.g. Industrial Conveyor Roller" oninput="builderState.name = this.value">
                </div>
                <div class="form-group">
                  <label class="form-label">Base Short Name (Code Suffix)</label>
                  <input type="text" class="form-input" id="b-code" value="${builderState.baseShortName}" placeholder="e.g. ROLLER" oninput="builderState.baseShortName = this.value.toUpperCase()">
                </div>
                <div class="form-group">
                  <label class="form-label">Category</label>
                  <select class="form-input" id="b-cat" onchange="builderState.categoryId = this.value">
                    ${state.categories.map((c) => `<option value="${c.id}" ${builderState.categoryId === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Unit of Measure</label>
                  <input type="text" class="form-input" id="b-unit" value="${builderState.unit}" placeholder="Piece, Meter, Box…" oninput="builderState.unit = this.value">
                </div>
              </div>

              <div class="form-group" style="margin-top: 10px;">
                <label class="form-label">Product Type</label>
                <div class="segmented-control" style="width: 100%;">
                  <button class="segmented-btn ${builderState.type === "simple" ? "active" : ""}" style="flex:1;" onclick="builderState.type='simple'; window.RS_APP.renderProductModal();">Simple Product</button>
                  <button class="segmented-btn ${builderState.type === "variable" ? "active" : ""}" style="flex:1;" onclick="builderState.type='variable'; window.RS_APP.renderProductModal();">Variable (Multi-Attribute)</button>
                  <button class="segmented-btn ${builderState.type === "measured" ? "active" : ""}" style="flex:1;" onclick="builderState.type='measured'; window.RS_APP.renderProductModal();">Measured (Length Rolls)</button>
                </div>
              </div>

              <!-- Product Image Section -->
              <div style="margin-top: 12px; padding: 10px 14px; background: var(--slate-50); border: 1px solid var(--slate-200); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 12px;">
                  <div style="width: 44px; height: 44px; border-radius: var(--radius-sm); border: 1px solid var(--slate-300); background: #ffffff; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                    ${builderState.imageUrl ? `<img src="${builderState.imageUrl}" style="width: 100%; height: 100%; object-fit: contain;">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--slate-400)"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`}
                  </div>
                  <div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--slate-800);">Product Image</div>
                    <div style="font-size: 11px; color: var(--slate-500);">${builderState.imageUrl ? "Square photo with studio white padding" : "No image uploaded yet"}</div>
                  </div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="window.RS_APP.openCropperForProduct('${builderState.productId || 'new'}')">
                  ${builderState.imageUrl ? "Edit / Re-Crop Photo" : "Upload & Crop Photo"}
                </button>
              </div>

              ${builderState.type !== "simple" ? `
                <div style="margin-top: 16px; border-top: 1px solid var(--slate-200); padding-top: 14px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <h4 style="font-size: 13px; font-weight: 700;">Attribute Definitions</h4>
                    <div style="display: flex; gap: 8px;">
                      <button class="btn btn-secondary btn-sm" onclick="window.RS_APP.addBuilderAttr()">+ Add Attribute</button>
                      <button class="btn btn-secondary btn-sm" onclick="window.RS_APP.addQualityAttr()"><span style="color: #f59e0b;">★</span> Add Quality</button>
                    </div>
                  </div>
                  ${builderState.attributes.map((a, i) => `
                    <div style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center;">
                      <input type="text" class="form-input" style="flex: 1;" placeholder="Attribute name (e.g. Size, Brand)" value="${a.name}" oninput="builderState.attributes[${i}].name = this.value">
                      ${!a.isQuality ? `
                        <input type="text" class="form-input" style="max-width: 100px;" placeholder="Unit (mm)" value="${a.unit || ""}" oninput="builderState.attributes[${i}].unit = this.value">
                      ` : ""}
                      <button type="button" class="btn btn-sm ${a.isQuality ? "btn-primary" : "btn-secondary"}" style="${a.isQuality ? "background: #f59e0b; border-color: #d97706; color: #fff;" : ""}" onclick="window.RS_APP.toggleQualityAttr(${i})" title="Toggle Quality rating attribute">
                        ${a.isQuality ? "★ Quality" : "☆ Quality"}
                      </button>
                      <button class="btn-link" style="color: var(--rose-600); font-size: 16px;" onclick="builderState.attributes.splice(${i}, 1); window.RS_APP.renderProductModal();">&times;</button>
                    </div>
                  `).join("")}
                </div>
              ` : ""}
            ` : ""}

            <!-- Step 2: Data & Abbreviations -->
            ${builderState.step === 2 ? `
              <div style="font-size: 13px; color: var(--slate-600); margin-bottom: 12px;">
                Define values and their short abbreviations used in code generation.
              </div>
              ${builderState.attributes.map((a, i) => `
                <div class="card" style="padding: 14px; margin-bottom: 12px;">
                  <div style="font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
                    <span>Attribute: ${a.name} ${a.isQuality ? `<span style="color:#f59e0b; font-size:12px; margin-left: 6px;">★ Quality Grade</span>` : (a.unit ? `(${a.unit})` : "")}</span>
                  </div>
                  ${a.isQuality ? `
                    <div style="font-size: 12px; color: var(--slate-500); margin-bottom: 8px;">Select active star ratings for this product:</div>
                    <div style="display: flex; gap: 8px; justify-content: space-around; background: #fff; padding: 10px; border-radius: 8px; border: 1px solid var(--slate-200); flex-wrap: wrap;">
                      ${[1, 2, 3, 4, 5].map((n) => {
                        const starsList = (a.stars && a.stars.length) ? a.stars : (a.values || []).map(Number).filter(Boolean);
                        const on = starsList.includes(n);
                        return `
                          <button type="button" class="btn ${on ? "btn-primary" : "btn-secondary"}" style="padding: 6px 14px; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 72px; ${on ? "background: #f59e0b; border-color: #d97706; color: #fff;" : ""}" onclick="window.RS_APP.toggleBuilderStar(${i}, ${n})">
                            <span style="font-size: 13px;">${"★".repeat(n)}</span>
                            <span style="font-size: 10.5px;">${n} star</span>
                          </button>
                        `;
                      }).join("")}
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-top: 10px;">
                      ${((a.stars && a.stars.length) ? a.stars : (a.values || []).map(Number).filter(Boolean)).sort((x, y) => x - y).map((n) => `
                        <div style="background: var(--slate-50); border: 1px solid var(--slate-200); padding: 6px 10px; border-radius: 6px; font-size: 12px;">
                          <div><span style="color: #f59e0b;">${"★".repeat(n)}</span> <b>${n} Star</b></div>
                          <input type="text" class="form-input" style="padding: 2px 6px; font-size: 11px; margin-top: 4px;" placeholder="${n}S" value="${(a.abbrMap && a.abbrMap[String(n)]) || ""}" oninput="if (!builderState.attributes[${i}].abbrMap) builderState.attributes[${i}].abbrMap = {}; builderState.attributes[${i}].abbrMap['${n}'] = this.value;">
                        </div>
                      `).join("")}
                    </div>
                  ` : `
                    <div class="form-group">
                      <label class="form-label">Allowed Values (Comma separated)</label>
                      <input type="text" class="form-input" value="${(a.values || []).join(", ")}" onchange="window.RS_APP.updateAttrValues(${i}, this.value)">
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-top: 8px;">
                      ${(a.values || []).map((val) => `
                        <div style="background: var(--slate-50); border: 1px solid var(--slate-200); padding: 6px 10px; border-radius: 6px; font-size: 12px;">
                          <div><b>${val}</b></div>
                          <input type="text" class="form-input" style="padding: 2px 6px; font-size: 11px; margin-top: 4px;" placeholder="Abbreviation" value="${(a.abbrMap && a.abbrMap[val]) || val}" oninput="if (!builderState.attributes[${i}].abbrMap) builderState.attributes[${i}].abbrMap = {}; builderState.attributes[${i}].abbrMap['${val}'] = this.value;">
                        </div>
                      `).join("")}
                    </div>
                  `}
                </div>
              `).join("")}
            ` : ""}

            <!-- Step 3: Generate Variations -->
            ${builderState.step === 3 ? `
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span style="font-size: 13px; color: var(--slate-600);">Auto-compose SKU combinations based on Step 2 definitions:</span>
                <button class="btn btn-secondary btn-sm" onclick="window.RS_APP.autoGenerateAllCombos()">Auto Generate All Combinations</button>
              </div>

              <div class="table-card">
                <table class="table" style="font-size: 12px;">
                  <thead>
                    <tr style="background: var(--slate-100);">
                      <th>Short Name</th>
                      <th>Attributes</th>
                      <th style="text-align: right;">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${builderState.variations.map((v, idx) => `
                      <tr>
                        <td><code style="font-family: var(--font-mono); font-weight: 700; color: var(--brand-700);">${v.shortName}</code></td>
                        <td>${Object.entries(v.attributes || {}).map(([k, val]) => {
                          const isQ = builderState.attributes.some((a) => a.name === k && a.isQuality) || k.toLowerCase() === "quality";
                          return `<span class="chip chip-slate" style="font-size: 10px;">${k}: ${isQ ? `<b style="color:#b45309;">${"★".repeat(Number(val) || 0)}</b> (${val}★)` : `<b>${val}</b>`}</span>`;
                        }).join(" ")}</td>
                        <td style="text-align: right;">
                          <button class="btn-link" style="color: var(--rose-600); font-size: 12px;" onclick="builderState.variations.splice(${idx}, 1); window.RS_APP.renderProductModal();">Delete</button>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : ""}

            <!-- Step 4: Pricing & Initial Stock -->
            ${builderState.step === 4 ? `
              <div style="font-size: 13px; color: var(--slate-600); margin-bottom: 12px;">
                Set commercial prices, reorder levels, and starting inventory for each variation:
              </div>
              <div class="table-card">
                <table class="table" style="font-size: 12px;">
                  <thead>
                    <tr style="background: var(--slate-100);">
                      <th>Variation</th>
                      <th style="width: 110px;">Stock</th>
                      <th style="width: 110px;">Min Price (₹)</th>
                      <th style="width: 110px;">Selling (₹)</th>
                      <th style="width: 110px;">Cost (₹)</th>
                      <th style="width: 110px;">Min Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${builderState.variations.map((v, i) => `
                      <tr>
                        <td><code style="font-family: var(--font-mono); font-weight: 600;">${v.shortName}</code></td>
                        <td><input type="number" class="form-input" style="padding: 4px;" value="${v.stock || 0}" oninput="builderState.variations[${i}].stock = Number(this.value);"></td>
                        <td><input type="number" class="form-input" style="padding: 4px;" value="${v.minSalePrice || 0}" oninput="builderState.variations[${i}].minSalePrice = Number(this.value);"></td>
                        <td><input type="number" class="form-input" style="padding: 4px;" value="${v.salePrice || 0}" oninput="builderState.variations[${i}].salePrice = Number(this.value);"></td>
                        <td><input type="number" class="form-input" style="padding: 4px;" value="${v.purchaseCost || 0}" oninput="builderState.variations[${i}].purchaseCost = Number(this.value);"></td>
                        <td><input type="number" class="form-input" style="padding: 4px;" value="${v.lowStockThreshold || 0}" oninput="builderState.variations[${i}].lowStockThreshold = Number(this.value);"></td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            ` : ""}
          </div>

          <div class="modal-footer">
            ${builderState.step > 1 ? `
              <button class="btn btn-secondary" onclick="window.RS_APP.setBuilderStep(${builderState.step - 1})">&larr; Previous</button>
            ` : ""}
            ${builderState.step < 4 ? `
              <button class="btn btn-primary" onclick="window.RS_APP.setBuilderStep(${builderState.step + 1})">Next Step &rarr;</button>
            ` : `
              <button class="btn btn-primary" onclick="window.RS_APP.commitSaveProduct()">Save Product</button>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function autoGenerateAllCombos() {
    const base = builderState.baseShortName || "ITEM";
    const attrs = builderState.attributes;
    if (!attrs || attrs.length === 0) {
      builderState.variations = [{
        id: "var_" + Date.now(),
        shortName: base,
        officialSku: base,
        attributes: {},
        stock: 0,
        salePrice: 100,
        minSalePrice: 90,
        purchaseCost: 70,
        lowStockThreshold: 10
      }];
      renderProductModal();
      return;
    }

    function cartesian(arrays) {
      return arrays.reduce((acc, curr) => acc.flatMap((d) => curr.map((e) => [...d, e])), [[]]);
    }

    const valueLists = attrs.map((a) => {
      if (a.isQuality) {
        const stars = ((a.stars && a.stars.length) ? a.stars : (a.values || []).map(Number).filter(Boolean)).sort((x, y) => x - y);
        return stars.length ? stars.map(String) : [];
      }
      return (a.values && a.values.length) ? a.values : ["Default"];
    });
    const combos = cartesian(valueLists);

    builderState.variations = combos.map((c, idx) => {
      const attrObj = {};
      const abbrParts = [];
      attrs.forEach((a, i) => {
        attrObj[a.name] = c[i];
        const val = c[i];
        const abbr = (a.abbrMap && a.abbrMap[val]) || "";
        let tok = abbr || val;
        if (!abbr && a.unit && !a.isQuality) {
          const u = a.unit.toUpperCase();
          if (!tok.toUpperCase().endsWith(u)) tok = tok + u;
        }
        abbrParts.push(tok);
      });
      const shortName = `${abbrParts.join("-")}-${base}`.toUpperCase();
      return {
        id: "var_" + Date.now() + "_" + idx,
        shortName: shortName,
        officialSku: shortName,
        attributes: attrObj,
        stock: 50,
        salePrice: 150,
        minSalePrice: 130,
        purchaseCost: 100,
        lowStockThreshold: 15
      };
    });

    renderProductModal();
    showToast(`Generated ${builderState.variations.length} variation combinations!`);
  }

  function commitSaveProduct() {
    if (!builderState.name) {
      alert("Please enter a product name.");
      return;
    }
    const cat = state.categories.find((c) => c.id === builderState.categoryId);
    const categoryName = cat ? cat.name : "General";

    // Normalize attributes for quality
    (builderState.attributes || []).forEach((a) => {
      if (a.isQuality) {
        a.unit = "";
        const stars = ((a.stars && a.stars.length) ? a.stars : (a.values || []).map(Number).filter(Boolean)).sort((x, y) => x - y);
        a.stars = stars;
        a.values = a.stars.map(String);
      }
    });

    if (builderState.isEdit && builderState.productId) {
      const idx = state.products.findIndex((p) => p.id === builderState.productId);
      if (idx >= 0) {
        state.products[idx].name = builderState.name;
        state.products[idx].baseShortName = builderState.baseShortName;
        state.products[idx].categoryId = builderState.categoryId;
        state.products[idx].categoryName = categoryName;
        state.products[idx].unit = builderState.unit;
        state.products[idx].productType = builderState.type;
        state.products[idx].imageUrl = builderState.imageUrl || state.products[idx].imageUrl || null;
        state.products[idx].attributes = builderState.attributes;
        state.products[idx].variations = builderState.variations;
      }
    } else {
      const newProd = {
        id: "prod_" + Date.now(),
        name: builderState.name,
        baseShortName: builderState.baseShortName || "ITEM",
        categoryId: builderState.categoryId,
        categoryName: categoryName,
        unit: builderState.unit || "Piece",
        productType: builderState.type,
        imageUrl: builderState.imageUrl || null,
        activityStatus: "Active",
        description: builderState.description,
        attributes: builderState.attributes,
        variations: builderState.variations.length ? builderState.variations : [{
          id: "var_" + Date.now(),
          shortName: (builderState.baseShortName || "ITEM"),
          officialSku: (builderState.baseShortName || "ITEM"),
          attributes: {},
          stock: 10,
          salePrice: 100,
          minSalePrice: 90,
          purchaseCost: 70,
          lowStockThreshold: 5
        }]
      };
      state.products.unshift(newProd);
    }

    closeModals();
    renderCurrentRoute();
    showToast(`Saved product "${builderState.name}"!`);
  }

  function openAddCategoryModal() {
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-overlay" onclick="window.RS_APP.closeModals()">
        <div class="modal-content" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div class="modal-title">Add New Category</div>
            <button class="modal-close" onclick="window.RS_APP.closeModals()">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Category Name</label>
              <input type="text" id="new-cat-name" class="form-input" placeholder="e.g. Pneumatics &amp; Hydraulic Hose">
            </div>
            <div class="form-group">
              <label class="form-label">Sort Order</label>
              <input type="number" id="new-cat-order" class="form-input" value="${state.categories.length + 1}">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.RS_APP.closeModals()">Cancel</button>
            <button class="btn btn-primary" onclick="window.RS_APP.commitAddCategory()">Save Category</button>
          </div>
        </div>
      </div>
    `;
  }

  function commitAddCategory() {
    const name = document.getElementById("new-cat-name")?.value;
    const order = Number(document.getElementById("new-cat-order")?.value) || state.categories.length + 1;
    if (!name) return;

    state.categories.push({
      id: "cat_" + Date.now(),
      name: name,
      sortOrder: order,
      active: true,
      count: 0
    });

    closeModals();
    renderCurrentRoute();
    showToast(`Category "${name}" created.`);
  }

  function openAddPartyModal(type) {
    const isSupp = type === "SUPPLIER";
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-overlay" onclick="window.RS_APP.closeModals()">
        <div class="modal-content wide" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div class="modal-title">Add New ${isSupp ? "Supplier" : "Customer"}</div>
            <button class="modal-close" onclick="window.RS_APP.closeModals()">&times;</button>
          </div>
          <div class="modal-body">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label class="form-label">Company / Trade Name</label>
                <input type="text" id="party-name" class="form-input" placeholder="e.g. Apex Industrial Works">
              </div>
              <div class="form-group">
                <label class="form-label">Contact Person</label>
                <input type="text" id="party-contact" class="form-input" placeholder="e.g. Ramesh Kumar">
              </div>
              <div class="form-group">
                <label class="form-label">Phone Number</label>
                <input type="text" id="party-phone" class="form-input" placeholder="+91 98000 00000">
              </div>
              <div class="form-group">
                <label class="form-label">City</label>
                <input type="text" id="party-city" class="form-input" placeholder="e.g. New Delhi">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Address</label>
              <textarea id="party-address" class="form-input" rows="2" placeholder="Full street address…"></textarea>
            </div>
            ${!isSupp ? `
              <div class="form-group">
                <label class="form-label">Initial Credit Score (0–100)</label>
                <input type="number" id="party-credit" class="form-input" value="80" min="0" max="100">
              </div>
            ` : ""}
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.RS_APP.closeModals()">Cancel</button>
            <button class="btn btn-primary" onclick="window.RS_APP.commitAddParty('${type}')">Save ${isSupp ? "Supplier" : "Customer"}</button>
          </div>
        </div>
      </div>
    `;
  }

  function commitAddParty(type) {
    const name = document.getElementById("party-name")?.value;
    if (!name) return;
    const contact = document.getElementById("party-contact")?.value;
    const phone = document.getElementById("party-phone")?.value;
    const city = document.getElementById("party-city")?.value;
    const address = document.getElementById("party-address")?.value;
    const credit = Number(document.getElementById("party-credit")?.value) || 80;

    const newP = {
      id: "pty_" + Date.now(),
      name: name,
      type: type,
      contactPerson: contact,
      phone: phone,
      city: city,
      address: address,
      creditScore: credit,
      active: true
    };

    state.parties.push(newP);
    closeModals();
    renderCurrentRoute();
    showToast(`Added ${name} to directory.`);
  }

  function openVendorPricesModal(varId) {
    let targetVar = null;
    state.products.forEach((p) => {
      const v = p.variations.find((x) => x.id === varId);
      if (v) targetVar = v;
    });
    if (!targetVar) return;

    const prices = state.vendorPrices.filter((x) => x.variationId === varId);
    const modalRoot = document.getElementById("modal-root");

    modalRoot.innerHTML = `
      <div class="modal-overlay" onclick="window.RS_APP.closeModals()">
        <div class="modal-content" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div>
              <div class="modal-title">Supplier Rates - ${targetVar.shortName}</div>
              <div style="font-size: 11px; color: var(--slate-500);">Pre-fills purchase bills when ordering from these vendors</div>
            </div>
            <button class="modal-close" onclick="window.RS_APP.closeModals()">&times;</button>
          </div>
          <div class="modal-body">
            ${prices.length === 0 ? `
              <div style="text-align: center; padding: 20px; color: var(--slate-500);">No supplier rate card configured for this SKU yet.</div>
            ` : `
              <table class="table" style="font-size: 12px; margin-bottom: 16px;">
                <thead>
                  <tr style="background: var(--slate-100);">
                    <th>Supplier</th>
                    <th>Rate</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  ${prices.map((p) => `
                    <tr>
                      <td style="font-weight: 600;">${p.supplierName}</td>
                      <td style="font-weight: 700; color: var(--brand-700);">${formatMoney(p.rate)}</td>
                      <td style="color: var(--slate-500);">${p.notes || "—"}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `}
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.RS_APP.closeModals()">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  function openAddUserModal() {
    const name = prompt("Enter new staff user full name:");
    if (!name) return;
    const email = prompt("Enter user email:", name.toLowerCase().replace(/\s+/g, "") + "@rsmachinery.demo");
    if (!email) return;

    state.users.push({
      id: "usr_" + Date.now(),
      name: name,
      email: email,
      role: "sales_staff",
      active: true
    });
    renderCurrentRoute();
    showToast(`Staff user "${name}" created.`);
  }

  function openAddVendorPriceModal() {
    const suppliers = state.parties.filter((p) => p.type === "SUPPLIER" || p.type === "BOTH");
    const activeSuppId = state.vendorPricingSupplierId || (suppliers[0] ? suppliers[0].id : "");
    const activeSupp = suppliers.find((s) => s.id === activeSuppId);

    const allVars = [];
    state.products.forEach((p) => {
      (p.variations || []).forEach((v) => {
        allVars.push({
          id: v.id,
          shortName: v.shortName || v.sku || p.name,
          productName: p.name,
          cost: v.purchaseCost || 0
        });
      });
    });

    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-overlay" onclick="window.RS_APP.closeModals()">
        <div class="modal-content" style="max-width: 500px;" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div>
              <div class="modal-title">Add Supplier Rate Card</div>
              <div style="font-size: 11px; color: var(--slate-500);">${activeSupp ? activeSupp.name : "Supplier rate card"}</div>
            </div>
            <button class="modal-close" onclick="window.RS_APP.closeModals()">&times;</button>
          </div>
          <form onsubmit="window.RS_APP.submitAddVendorPrice(event)">
            <div class="modal-body" style="display: flex; flex-direction: column; gap: 12px;">
              <div class="form-group">
                <label class="form-label" style="font-size: 12px; font-weight: 600;">Supplier *</label>
                <select id="avp-supplier" class="input" style="width: 100%;">
                  ${suppliers.map((s) => `
                    <option value="${s.id}" ${s.id === activeSuppId ? "selected" : ""}>${s.name} ${s.city ? `(${s.city})` : ""}</option>
                  `).join("")}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" style="font-size: 12px; font-weight: 600;">SKU / Variation *</label>
                <select id="avp-variation" class="input" style="width: 100%;">
                  ${allVars.map((v) => `
                    <option value="${v.id}" data-shortname="${v.shortName}" data-cost="${v.cost}">${v.shortName} — ${v.productName}</option>
                  `).join("")}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" style="font-size: 12px; font-weight: 600;">Agreed Rate (₹) *</label>
                <input id="avp-rate" type="number" class="input" style="width: 100%; font-weight: 700; font-size: 15px;" placeholder="Enter rate in whole rupees" required min="1" step="1" value="${allVars[0]?.cost || ""}">
              </div>
              <div class="form-group">
                <label class="form-label" style="font-size: 12px; font-weight: 600;">Notes &amp; MOQ</label>
                <input id="avp-notes" type="text" class="input" style="width: 100%;" placeholder="e.g. MOQ 100 pcs, March agreement">
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="window.RS_APP.closeModals()">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Rate Card</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function submitAddVendorPrice(e) {
    e.preventDefault();
    const suppSelect = document.getElementById("avp-supplier");
    const varSelect = document.getElementById("avp-variation");
    const rateInput = document.getElementById("avp-rate");
    const notesInput = document.getElementById("avp-notes");

    const supplierId = suppSelect.value;
    const supp = state.parties.find((p) => p.id === supplierId);
    const varId = varSelect.value;
    const selectedOpt = varSelect.options[varSelect.selectedIndex];
    const shortName = selectedOpt.getAttribute("data-shortname") || "SKU";
    const rate = Number(rateInput.value);
    const notes = notesInput.value.trim();

    const existing = state.vendorPrices.find((x) => x.variationId === varId && x.supplierId === supplierId);
    if (existing) {
      existing.rate = rate;
      existing.notes = notes;
      existing.active = true;
      showToast("Updated existing rate card");
    } else {
      state.vendorPrices.push({
        id: "vp_" + Date.now(),
        variationId: varId,
        shortName: shortName,
        supplierId: supplierId,
        supplierName: supp ? supp.name : "Supplier",
        rate: rate,
        active: true,
        notes: notes
      });
      showToast("Added supplier rate card");
    }
    state.vendorPricingSupplierId = supplierId;
    closeModals();
    renderCurrentRoute();
  }

  function openVendorPriceHistoryModal(vpId) {
    const vp = state.vendorPrices.find((x) => x.id === vpId);
    if (!vp) return;

    const historyEntries = vp.history || [
      {
        date: "2026-10-15 14:30",
        rate: vp.rate,
        active: true,
        notes: vp.notes || "Current agreed rate",
        recordedBy: "admin"
      },
      {
        date: "2026-08-10 11:15",
        rate: Math.round(vp.rate * 0.95),
        active: true,
        notes: "Prior rate agreement",
        recordedBy: "admin"
      }
    ];

    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-overlay" onclick="window.RS_APP.closeModals()">
        <div class="modal-content" style="max-width: 600px;" onclick="event.stopPropagation()">
          <div class="modal-header">
            <div>
              <div class="modal-title">Price History — ${vp.shortName}</div>
              <div style="font-size: 11px; color: var(--slate-500);">${vp.supplierName}</div>
            </div>
            <button class="modal-close" onclick="window.RS_APP.closeModals()">&times;</button>
          </div>
          <div class="modal-body">
            <table class="table" style="font-size: 12px;">
              <thead>
                <tr style="background: var(--slate-100);">
                  <th>Date</th>
                  <th style="text-align: right;">Rate</th>
                  <th style="text-align: center;">Status</th>
                  <th>Notes</th>
                  <th>Recorded By</th>
                </tr>
              </thead>
              <tbody>
                ${historyEntries.map((h, i) => `
                  <tr>
                    <td style="color: var(--slate-600); font-family: var(--font-mono); font-size: 11px;">${h.date}</td>
                    <td style="text-align: right; font-weight: 700; color: ${i === 0 ? "var(--brand-700)" : "var(--slate-700)"};">${formatMoney(h.rate)}</td>
                    <td style="text-align: center;"><span class="chip ${h.active ? "chip-active" : "chip-draft"}" style="font-size: 10px;">${h.active ? "Active" : "Paused"}</span></td>
                    <td style="color: var(--slate-600); font-size: 11px;">${h.notes || "—"}</td>
                    <td style="color: var(--slate-500); font-size: 11px;">${h.recordedBy}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.RS_APP.closeModals()">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  // Public prototype API
  window.RS_APP = {
    state,
    navigate,
    toggleMobileMenu,
    toggleCartSidebar,
    removeCartLine,
    clearCart,
    proceedToCheckout,
    closeModals,
    closeDrawers,
    openProductDetailModal,
    openStockAdjustModal,
    commitStockAdjustment,
    openPartySelectDrawer,
    selectParty,
    openProductCartDrawer,
    handleDrawerVariationChange,
    calculateDrawerLineTotal,
    commitAddDrawerToCart,
    commitCheckout,
    saveAsOrder,
    holdCart,
    handleStockInEdit,
    commitStockIn,
    resetStockInEdits,
    exportCsv,
    downloadJsonBackup,
    openRoleSwitcher,
    setRole,

    // Product Modal / 4-Step Builder
    openAddProductModal,
    openEditProductModal,
    renderProductModal,
    setBuilderStep: (s) => { builderState.step = s; renderProductModal(); },
    addBuilderAttr: () => {
      builderState.attributes.push({ name: "New Attribute", unit: "", values: ["Val1", "Val2"], abbrMap: {} });
      renderProductModal();
    },
    addQualityAttr: () => {
      builderState.attributes.push({
        name: "Quality",
        unit: "",
        isQuality: true,
        stars: [],
        values: [],
        abbrMap: {}
      });
      renderProductModal();
    },
    toggleQualityAttr: (idx) => {
      const a = builderState.attributes[idx];
      if (!a) return;
      if (a.isQuality) {
        a.isQuality = false;
        a.unit = "";
        a.stars = [];
        a.values = a.values && a.values.length ? a.values : [""];
      } else {
        a.isQuality = true;
        a.name = a.name && a.name.trim() ? a.name : "Quality";
        a.unit = "";
        a.stars = [];
        a.values = [];
        if (!a.abbrMap) a.abbrMap = {};
      }
      renderProductModal();
    },
    toggleBuilderStar: (attrIdx, starNum) => {
      const a = builderState.attributes[attrIdx];
      if (!a) return;
      let stars = ((a.stars && a.stars.length) ? a.stars : (a.values || []).map(Number).filter(Boolean)).slice();
      if (stars.includes(starNum)) {
        stars = stars.filter((s) => s !== starNum);
      } else {
        stars.push(starNum);
      }
      stars.sort((x, y) => x - y);
      a.stars = stars;
      a.values = stars.map(String);
      renderProductModal();
    },
    updateAttrValues: (idx, csv) => {
      builderState.attributes[idx].values = csv.split(",").map((s) => s.trim()).filter(Boolean);
      renderProductModal();
    },
    autoGenerateAllCombos,
    commitSaveProduct,

    // Categories
    openAddCategoryModal,
    commitAddCategory,
    editCategory: (id) => {
      const c = state.categories.find((x) => x.id === id);
      if (c) {
        const newName = prompt("Rename category:", c.name);
        if (newName) {
          c.name = newName;
          renderCurrentRoute();
          showToast("Category updated");
        }
      }
    },

    // Parties
    openAddPartyModal,
    commitAddParty,
    openEditPartyModal: (id) => {
      const p = state.parties.find((x) => x.id === id);
      if (p) {
        const phone = prompt("Update phone number for " + p.name + ":", p.phone || "");
        if (phone !== null) {
          p.phone = phone;
          renderCurrentRoute();
          showToast("Party updated");
        }
      }
    },

    // Vendor prices
    openVendorPricesModal,
    openAddVendorPriceModal,
    submitAddVendorPrice,
    openVendorPriceHistoryModal,
    editVendorPrice: (id) => {
      const vp = state.vendorPrices.find((x) => x.id === id);
      if (vp) {
        const newRate = prompt("Enter updated rate for " + vp.shortName + " from " + vp.supplierName + ":", vp.rate);
        if (newRate) {
          vp.rate = Number(newRate);
          renderCurrentRoute();
          showToast("Supplier rate updated");
        }
      }
    },
    setVendorPricingSupplier: (id) => {
      state.vendorPricingSupplierId = id;
      renderCurrentRoute();
    },
    setVendorPricingSupplierSearch: (q) => {
      state.vendorPricingSupplierSearch = q;
      renderCurrentRoute();
    },
    setVendorPricingProductSearch: (q) => {
      state.vendorPricingProductSearch = q;
      renderCurrentRoute();
    },

    // Users
    openAddUserModal,

    // Filter helpers
    setProductsViewMode: (mode) => { state.productsViewMode = mode; renderCurrentRoute(); },
    setProductsSearch: (q) => { state.productsSearch = q; renderCurrentRoute(); },
    setProductsCategory: (c) => { state.productsCategory = c; renderCurrentRoute(); },
    setProductsActivity: (a) => { state.productsActivity = a; renderCurrentRoute(); },
    setQuickFilter: (q) => { state.productsQuick = q; renderCurrentRoute(); },
    setInventorySearch: (q) => { state.inventorySearch = q; renderCurrentRoute(); },
    setInventoryCategory: (c) => { state.inventoryCategory = c; renderCurrentRoute(); },
    setInventoryStage: (s) => { state.inventoryStage = s; renderCurrentRoute(); },
    toggleProductRow: (id) => {
      if (state.productsExpanded.has(id)) state.productsExpanded.delete(id);
      else state.productsExpanded.add(id);
      renderCurrentRoute();
    },

    // Drag and drop variation reordering
    handleVarDragStart: (e, prodId, varId) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ prodId, varId }));
      e.target.classList.add("row-dragging");
    },
    handleVarDragOver: (e) => {
      e.preventDefault();
    },
    handleVarDrop: (e, targetProdId, targetVarId) => {
      e.preventDefault();
      try {
        const raw = e.dataTransfer.getData("text/plain");
        const { prodId, varId } = JSON.parse(raw);
        if (prodId === targetProdId && varId !== targetVarId) {
          const p = state.products.find((x) => x.id === prodId);
          if (p) {
            const idx1 = p.variations.findIndex((x) => x.id === varId);
            const idx2 = p.variations.findIndex((x) => x.id === targetVarId);
            if (idx1 >= 0 && idx2 >= 0) {
              const [moved] = p.variations.splice(idx1, 1);
              p.variations.splice(idx2, 0, moved);
              renderCurrentRoute();
              showToast("Variation order updated");
            }
          }
        }
      } catch (err) {}
    },

    openOrderDetail: (id, kind) => navigate(kind === "SALE" ? "sale-order-detail" : "purchase-order-detail", { id }),
    advanceOrderStatus: (id, kind, newStatus) => {
      const orders = kind === "SALE" ? state.saleOrders : state.purchaseOrders;
      const order = orders.find((o) => o.id === id);
      if (order) {
        order.status = newStatus;
        order.events.push({
          status: newStatus,
          note: `Advanced to ${newStatus} by user`,
          at: new Date().toISOString(),
          by: state.currentUser.name
        });
        renderCurrentRoute();
        showToast(`Order status updated to ${newStatus}`);
      }
    },
    cancelOrder: (id, kind) => {
      const reason = prompt("Enter cancellation reason:");
      if (!reason) return;
      const orders = kind === "SALE" ? state.saleOrders : state.purchaseOrders;
      const order = orders.find((o) => o.id === id);
      if (order) {
        order.status = "CANCELLED";
        order.events.push({
          status: "CANCELLED",
          note: `Cancelled: ${reason}`,
          at: new Date().toISOString(),
          by: state.currentUser.name
        });
        renderCurrentRoute();
        showToast("Order cancelled");
      }
    },
    openDocumentDetail: (id, mode) => navigate(mode === "sale" ? "sale-document" : "purchase-document", { id }),
    voidDocument: (id, mode) => {
      const reason = prompt("Enter cancellation / void reason:");
      if (!reason) return;
      const docs = mode === "sale" ? state.sales : state.purchases;
      const doc = docs.find((d) => d.id === id);
      if (doc) {
        doc.status = "CANCELLED";
        doc.voidReason = reason;
        // Reverse stock
        doc.lines.forEach((l) => {
          state.products.forEach((p) => {
            const v = p.variations.find((x) => x.id === l.variationId);
            if (v) {
              if (mode === "sale") v.stock += l.quantity; // reverse sale
              else v.stock -= l.quantity; // reverse purchase
            }
          });
        });
        renderCurrentRoute();
        showToast(`Document ${doc.number} voided and stock movements reversed.`);
      }
    },
    openPartyDetail: (id) => navigate("party-detail", { id }),
    startCartForParty: (partyId, mode) => {
      const p = state.parties.find((x) => x.id === partyId);
      state.cart.party = p || null;
      state.cart.mode = mode;
      navigate(mode === "sale" ? "sales-new" : "purchases-new");
    },
    toggleCategoryActive: (id) => {
      const c = state.categories.find((x) => x.id === id);
      if (c) {
        c.active = !c.active;
        renderCurrentRoute();
        showToast(`Category "${c.name}" marked as ${c.active ? "active" : "inactive"}`);
      }
    },
    toggleUserActive: (id) => {
      const u = state.users.find((x) => x.id === id);
      if (u) {
        u.active = !u.active;
        renderCurrentRoute();
        showToast(`User "${u.name}" ${u.active ? "activated" : "deactivated"}`);
      }
    },
    loadSampleImageEditor: () => loadSampleImageEditor(),
    loadImageEditorFile: (e) => loadImageEditorFile(e),
    handleImageDrop: (e) => handleImageDrop(e),
    setImgEditorZoom: (val) => {
      imgEditor.zoom = Math.max(0.2, Math.min(3, val));
      const range = document.getElementById("cropper-zoom-range");
      if (range) range.value = imgEditor.zoom;
      const readout = document.getElementById("zoom-readout");
      if (readout) readout.textContent = Math.round(imgEditor.zoom * 100) + "%";
      redrawCropperStage();
    },
    stepImgEditorZoom: (delta) => {
      imgEditor.zoom = Math.max(0.2, Math.min(3, Number((imgEditor.zoom + delta).toFixed(2))));
      const range = document.getElementById("cropper-zoom-range");
      if (range) range.value = imgEditor.zoom;
      const readout = document.getElementById("zoom-readout");
      if (readout) readout.textContent = Math.round(imgEditor.zoom * 100) + "%";
      redrawCropperStage();
    },
    rotateImgEditor: (delta) => {
      imgEditor.rotation = (imgEditor.rotation + delta + 360) % 360;
      redrawCropperStage();
    },
    resetImgEditor: () => {
      imgEditor.zoom = 1;
      imgEditor.rotation = 0;
      imgEditor.panX = 0;
      imgEditor.panY = 0;
      const range = document.getElementById("cropper-zoom-range");
      if (range) range.value = 1;
      const readout = document.getElementById("zoom-readout");
      if (readout) readout.textContent = "100%";
      redrawCropperStage();
    },
    downloadCroppedImage: () => downloadCroppedImage(),
    saveCroppedToCatalog: (id) => saveCroppedToCatalog(id),
    openCropperForProduct: (id) => {
      imgEditor.targetProductId = id || (builderState.productId || "new");
      closeModals();
      navigate("image-editor");
    }
  };

  // Initialization
  window.addEventListener("hashchange", handleHashChange);
  document.addEventListener("DOMContentLoaded", () => {
    // Set formatted IST date in header
    const dateEl = document.getElementById("current-ist-date");
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      });
    }

    handleHashChange();
  });
})();
