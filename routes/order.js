const express = require("express");
const router = express.Router();
const { getDBPool } = require("../db");

// Function to generate unique Order Number
const generateOrderNumber = () => {
  return `ORD-${Date.now()}`;
};

// Create Order API
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
  } = req.body;

  if (!storeName) {
    return res.status(400).json({ message: "Missing storeName field" });
  }

  try {
    const cloudPool = getDBPool(true); // Cloud DB
    const localPool = getDBPool(false); // Local DB

    // ✅ Get storeId from storeName
    const [storeResult] = await localPool.query(
      `SELECT id FROM tblstores WHERE Storename = ? LIMIT 1`,
      [storeName]
    );

    if (!storeResult.length) {
      return res.status(400).json({ message: "Invalid storeName" });
    }

    const storeId = storeResult[0].id; // ✅ Mapped storeId from storeName

    // ✅ Generate Order Number
    const OrderNo = generateOrderNumber();

    // ✅ Insert into **CLOUD DB** (tblorders)
    const cloudQuery = `
      INSERT INTO tblorders (
        DateTime, OrderNo, StockCode, StockDescription, MajorNo, MajorName, 
        Sub1No, Sub1Name, Order_Qty, Rcvd_Qty, Amended_Qty, Final_Qty, Amended_Shop
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      DateTime,
      OrderNo,
      StockCode,
      StockDescription,
      MajorNo,
      MajorName,
      Sub1No,
      Sub1Name,
      Order_Qty,
      Rcvd_Qty || 0,
      Amended_Qty || 0,
      Final_Qty || 0,
      Amended_Shop || null,
    ];

    await cloudPool.query(cloudQuery, values);

    const localOrderQuery = `
    INSERT INTO tblorder (
      DateTime, OrderNo, StoreName, OrderComplete, User
    ) 
    VALUES (?, ?, ?, ?, ?)`;
  
  // ✅ Insert storeName instead of storeId
  await localPool.query(localOrderQuery, [DateTime, OrderNo, storeName, 0, "System"]);
  

    // ✅ Insert into **LOCAL DB** (tblorder_tran)
    const localOrderTranQuery = `
      INSERT INTO tblorder_tran (
        DateTime, OrderNo, StockCode, StockDescription, MajorNo, MajorName, 
        Sub1No, Sub1Name, Order_Qty, Rcvd_Qty, Amended_Qty, Final_Qty, Amended_Shop
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await localPool.query(localOrderTranQuery, values);

    // ✅ Insert into **LOCAL DB** (tblorderboxinfo)  
    if (BoxNo && BoxCodeQty && BoxTotalQty) {
      const localBoxQuery = `
        INSERT INTO tblorderboxinfo (
          OrderNo, StockCode, BoxNo, BoxCodeQty, BoxTotalQty, DoneAndPrinted
        ) 
        VALUES (?, ?, ?, ?, ?, ?)`;

      await localPool.query(localBoxQuery, [OrderNo, StockCode, BoxNo, BoxCodeQty, BoxTotalQty, 0]);
    }

    res.status(201).json({
      message: "Order Created Successfully",
      orderNo: OrderNo,
    });

  } catch (error) {
    console.error(error);
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
        ot.Order_Qty,  -- ✅ Now taking from tblorder_tran
        ot.Final_Qty
      FROM tblorder o
      LEFT JOIN tblorder_tran ot ON o.OrderNo = ot.OrderNo -- ✅ Joining correctly
      ORDER BY o.DateTime DESC
    `;

    const [orders] = await localPool.query(query);

    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
});

// ✅ Approve Order API (Fixed Column Names)
router.post("/approve-order", async (req, res) => {
  const { orderId, approvedQty, approvedBy } = req.body;

  if (!orderId || !approvedQty || !approvedBy) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const localPool = getDBPool(false); // Local DB

  try {
    // 🟢 Step 1: Update `Final_Qty` in `tblorder_tran`
    const updateOrderTranQuery = `
      UPDATE tblorder_tran 
      SET Final_Qty = ? 
      WHERE OrderNo = ?
    `;
    const [orderTranResult] = await localPool.query(updateOrderTranQuery, [approvedQty, orderId]);

    // 🟢 Step 2: Update `Approved_By` and `Approved_Date` in `tblorder`
    const updateOrderQuery = `
      UPDATE tblorder 
      SET Order_Approved_By = ?, 
          OrderComplete = 1, 
          Order_Approved_Date = NOW() 
      WHERE OrderNo = ?
    `;
    const [orderResult] = await localPool.query(updateOrderQuery, [approvedBy, orderId]);

    // 🛑 Check if order exists
    if (orderResult.affectedRows === 0 && orderTranResult.affectedRows === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ message: "Order approved successfully" });

  } catch (error) {
    console.error("Approval Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
// ✅ Pack Order API
router.post("/pack-order", async (req, res) => {
  const { orderId, packedBy } = req.body;

  if (!orderId || !packedBy) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const localPool = getDBPool(false); // Local DB

  try {
    // 🟢 Step 1: Update `Order_Packed_By` and `Order_Packed_Date`
    const updatePackedQuery = `
      UPDATE tblorder 
      SET Order_Packed_By = ?, 
          Order_Packed_Date = NOW() 
      WHERE OrderNo = ?
    `;
    
    const [result] = await localPool.query(updatePackedQuery, [packedBy, orderId]);

    // 🛑 Check if the order exists
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ message: "Order packed successfully" });

  } catch (error) {
    console.error("Packing Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


module.exports = router;
