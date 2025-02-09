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

// ✅ Fetch Orders from Local DB
router.get("/fetch-orders", async (req, res) => {
  try {
    const query = `SELECT * FROM tblorder ORDER BY DateTime DESC`; // ✅ Orders ko latest se sort karna
    const [orders] = await localPool.query(query);
    
    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
});


module.exports = router;
