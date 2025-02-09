const express = require("express");
const router = express.Router();
const { getDBPool } = require("../db");
// Function to generate unique Order Number
const generateOrderNumber = () => {
  return `ORD-${Date.now()}`;
};

router.post("/create-order", async (req, res) => {
  const {
    DateTime,
    StockCode,
    StockDescription,
    MajorNo,
    MajorName,
    Sub1No,
    Sub1Name,
    Order_Qty,
    Rcvd_Qty,
    Amended_Qty,
    Final_Qty,
    Amended_Shop,
    storeName, // Store name from frontend
    BoxNo,
    BoxCodeQty,
    BoxTotalQty,
    User,
  } = req.body;


  // ✅ Generate Order Number **only once**
  const OrderNo = generateOrderNumber();

  console.log("✅ Generated Order Number:", OrderNo);

  try {
    const cloudPool = getDBPool(true);
    const localPool = getDBPool(false);

    const cloudQuery = `
    INSERT INTO tblorders (
      DateTime, OrderNo, StockCode, StockDescription, MajorNo, MajorName, storeName, 
      Sub1No, Sub1Name, Order_Qty, Rcvd_Qty, Amended_Qty, Final_Qty, Amended_Shop, User
    ) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
  `;
  

    const values = [
      DateTime,
      OrderNo, 
      StockCode,
      StockDescription,
      MajorNo,
      MajorName,
      storeName,  // ✅ Add storeName here
      Sub1No || null,   // ✅ Convert empty string to NULL
      Sub1Name || null,  // ✅ Convert empty string to NULL
      Order_Qty,
      Rcvd_Qty || 0,
      Amended_Qty || 0,
      Final_Qty || 0,
      Amended_Shop || null,
      User || null
    ];
    
    await cloudPool.query(cloudQuery, values);
    console.log("✅ Inserted into Cloud DB:", OrderNo);

    // ✅ Insert into Local DB (tblorder)
    const localOrderQuery = `
      INSERT INTO tblorder (
        DateTime, OrderNo, StoreName, OrderComplete, User
      ) 
      VALUES (?, ?, ?, ?, ?)
    `;

    await localPool.query(localOrderQuery, [DateTime, OrderNo, storeName, 0, User]);
    console.log("✅ Inserted into Local DB tblorder:", OrderNo);

    // ✅ Insert into Local DB (tblorder_tran)
    const localOrderTranQuery = `
      INSERT INTO tblorder_tran (
        DateTime, OrderNo, StockCode, StockDescription, MajorNo, MajorName, 
        Sub1No, Sub1Name, Order_Qty, Rcvd_Qty, Amended_Qty, Final_Qty, Amended_Shop
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await localPool.query(localOrderTranQuery, values);
    console.log("✅ Inserted into Local DB tblorder_tran:", OrderNo);

    // ✅ Insert into Local DB (tblorderboxinfo) if Box data exists
    if (BoxNo && BoxCodeQty && BoxTotalQty) {
      const localBoxQuery = `
        INSERT INTO tblorderboxinfo (
          OrderNo, StockCode, BoxNo, BoxCodeQty, BoxTotalQty, DoneAndPrinted
        ) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      await localPool.query(localBoxQuery, [OrderNo, StockCode, BoxNo, BoxCodeQty, BoxTotalQty, 0]);
      console.log("✅ Inserted into Local DB tblorderboxinfo:", OrderNo);
    }

    res.status(201).json({
      message: "Order Created Successfully",
      orderNo: OrderNo,
    });

  } catch (error) {
    console.error("❌ Error creating order:", error);
    res.status(500).json({ message: "Error creating order", error: error.message });
  }
});



// ✅ Fetch Orders from Local DB with tblorder, tblordertran, tblorderboxingo
router.get("/orders", async (req, res) => {
  try {
    const localPool = getDBPool(false); // Local DB

    const query = `
SELECT 
    o.OrderNo, 
    o.StoreName, 
    o.DateTime,
    o.Order_Packed_By,
    o.Order_Packed_Date,
    o.Order_Approved_By,
    o.Order_Dispatch_By,
    o.Order_Dispatched_Date,
    o.Order_Approved_Date,
    o.Order_Rcvd_Date,
    o.User,
    ot.Order_Qty,  
    ot.Final_Qty,
     ot.Amended_Qty
FROM tblorder o
LEFT JOIN tblorder_tran ot ON o.OrderNo = ot.OrderNo
WHERE o.OrderNo IS NOT NULL -- ✅ Ensure OrderNo exists

UNION

SELECT 
    ot.OrderNo, 
    NULL AS StoreName, 
    NULL AS DateTime,
    NULL AS Order_Packed_By,
    NULL AS Order_Packed_Date,
    NULL AS Order_Approved_By,
    NULL AS Order_Dispatch_By,
    NULL AS Order_Dispatched_Date,
      NULL AS Order_Approved_Date,
    NULL AS Order_Rcvd_Date,
    NULL AS User,
    ot.Order_Qty,  
    ot.Final_Qty,
    ot.Amended_Qty
FROM tblorder_tran ot
LEFT JOIN tblorder o ON o.OrderNo = ot.OrderNo
WHERE ot.OrderNo IS NOT NULL -- ✅ Ensure OrderNo exists

ORDER BY DateTime DESC;
  `;

    const [orders] = await localPool.query(query);

    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
});

router.post("/approve-order", async (req, res) => {
  const { orderId, approvedQty, approvedBy } = req.body;

  if (!orderId || !approvedQty || !approvedBy) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const localPool = getDBPool(false); // Local DB
  const cloudPool = getDBPool(true); // Cloud DB

  try {
    // 🟢 Step 1: Update `Final_Qty` in `tblorder_tran` (Local)
    const updateOrderTranQuery = `
      UPDATE tblorder_tran 
      SET Final_Qty = ? 
      WHERE OrderNo = ?
    `;
    const [orderTranResult] = await localPool.query(updateOrderTranQuery, [approvedQty, orderId]);

    // 🟢 Step 2: Update `Approved_By` and `Approved_Date` in `tblorder` (Local)
    const updateOrderQuery = `
      UPDATE tblorder 
      SET Order_Approved_By = ?, 
          OrderComplete = 1, 
          Order_Approved_Date = NOW() 
      WHERE OrderNo = ?
    `;
    const [orderResult] = await localPool.query(updateOrderQuery, [approvedBy, orderId]);

    if (orderResult.affectedRows === 0 && orderTranResult.affectedRows === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    // ✅ Step 3: Sync with Cloud Database
    const cloudUpdateQuery = `
      UPDATE warehousemaster.tblorders 
      SET Order_Approved_By = ?, 
          OrderComplete = 1, 
          Order_Approved_Date = NOW() 
      WHERE OrderNo = ?
    `;
    await cloudPool.query(cloudUpdateQuery, [approvedBy, orderId]);

    res.json({ message: "Order approved and synced with cloud successfully" });

  } catch (error) {
    console.error("Approval Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/pack-order", async (req, res) => {
  const { orderId, packedBy } = req.body;

  if (!orderId || !packedBy) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const localPool = getDBPool(false); // Local DB
  const cloudPool = getDBPool(true); // Cloud DB

  try {
    // 🟢 Step 1: Update `Order_Packed_By` and `Order_Packed_Date` (Local)
    const updatePackedQuery = `
      UPDATE tblorder 
      SET Order_Packed_By = ?, 
          Order_Packed_Date = NOW() 
      WHERE OrderNo = ?
    `;
    
    const [result] = await localPool.query(updatePackedQuery, [packedBy, orderId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    // ✅ Step 2: Sync with Cloud Database
    const cloudUpdateQuery = `
      UPDATE warehousemaster.tblorders 
      SET Order_Packed_By = ?, 
          Order_Packed_Date = NOW() 
      WHERE OrderNo = ?
    `;
    await cloudPool.query(cloudUpdateQuery, [packedBy, orderId]);

    res.json({ message: "Order packed and synced with cloud successfully" });

  } catch (error) {
    console.error("Packing Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


// ✅ Fetch Only Packed Orders
router.get("/get-packed-orders", async (req, res) => {
  try {
    const localPool = getDBPool(false);
    const [results] = await localPool.query(
      "SELECT * FROM tblorder WHERE Order_Packed_By IS NOT NULL AND Order_Dispatch_By IS NULL"
    );
    res.json(results);
  } catch (err) {
    console.error("Error fetching packed orders:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ✅ Dispatch Order API
router.post("/dispatch-order", async (req, res) => {
  const { orderId, dispatchedBy } = req.body;
  if (!orderId || !dispatchedBy) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const localPool = getDBPool(false); // Local database connection
    const cloudPool = getDBPool(true);  // Cloud database connection

    // ✅ Update Local Database
    const [localResult] = await localPool.query(
      `UPDATE tblorder SET Order_Dispatch_By = ?, Order_Dispatched_Date = NOW() WHERE OrderNo = ?`,
      [dispatchedBy, orderId]
    );

    if (localResult.affectedRows === 0) {
      return res.status(404).json({ message: "Order not found in local DB" });
    }

    const [cloudResult] = await cloudPool.query(
      `UPDATE warehousemaster.tblorders SET Order_Dispatch_By = ?, Order_Dispatched_Date = NOW() WHERE OrderNo = ?`,
      [dispatchedBy, orderId]
    );
    
    if (cloudResult.affectedRows === 0) {
      console.error("❌ Order not found in cloud DB:", orderId);
      return res.status(404).json({ message: "Order not found in cloud DB" });
    }
    

    // ✅ Sync Shop Database
    await syncShopDB(orderId);

    res.json({ message: "Order dispatched successfully and updated in cloud DB" });
  } catch (error) {
    console.error("Dispatch Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

const syncShopDB = async (orderId) => {
  try {
    const localPool = getDBPool(false);
    const [orders] = await localPool.query("SELECT * FROM tblorder WHERE OrderNo = ?", [orderId]);

    if (orders.length === 0) {
      console.error("❌ Order not found for sync:", orderId);
      return;
    }

    const order = orders[0];
    if (!order.StoreName) {
      console.error("❌ StoreName missing for order:", orderId);
      return;
    }

    // ✅ Ensure shopPool gets the correct store name
    const shopPool = getDBPool(false, order.StoreName);
    
    // ✅ Correct the SQL query (it was missing a parameter)
    const [shopResult] = await shopPool.query(
      "UPDATE tblorder SET Order_Dispatch_By = ?, Order_Dispatched_Date = NOW() WHERE OrderNo = ?",
      [order.Order_Dispatch_By, order.OrderNo] // Fixing missing parameter
    );

    if (shopResult.affectedRows === 0) {
      console.error(`❌ Order ${orderId} not found in Shop DB: ${order.StoreName}`);
    } else {
      console.log(`✅ Synced Order ${orderId} with Shop DB: ${order.StoreName}`);
    }
  } catch (error) {
    console.error("❌ Error syncing order to shop DB:", error);
  }
};

module.exports = router;
