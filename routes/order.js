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
    storeName,
    User,
  } = req.body;

  const OrderNo = generateOrderNumber();
  console.log("✅ Generated Order Number:", OrderNo);

  try {
    const cloudPool = getDBPool(true);
    const localPool = getDBPool(false);

    // ✅ Insert into Cloud DB (tblorders)
    const cloudQuery = `
      INSERT INTO tblorders (
        DateTime, OrderNo, StockCode, StockDescription, MajorNo, MajorName, storeName, 
        Sub1No, Sub1Name, Order_Qty, Rcvd_Qty, Amended_Qty, Final_Qty, Amended_Shop, User
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      DateTime,
      OrderNo,
      StockCode,
      StockDescription,
      MajorNo,
      MajorName,
      storeName,
      Sub1No || null,
      Sub1Name || null,
      parseInt(Order_Qty) || 0,
      parseInt(Rcvd_Qty) || 0,
      parseInt(Amended_Qty) || 0,
      parseInt(Final_Qty) || parseInt(Order_Qty) || 0,
      Amended_Shop || null,
      User || null,
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

  // ✅ Ensure `Final_Qty` is set correctly
const finalQty = parseInt(Final_Qty) || parseInt(Order_Qty) || 0;
const amendedQty = parseInt(Amended_Qty) || 0;

const localOrderTranQuery = `
  INSERT INTO tblorder_tran (
    DateTime, OrderNo, StockCode, StockDescription, MajorNo, MajorName, 
    Sub1No, Sub1Name, Order_Qty, Amended_Qty, Final_Qty, Amended_Shop
  ) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

await localPool.query(localOrderTranQuery, [
  DateTime, OrderNo, StockCode, StockDescription, MajorNo, MajorName,
  Sub1No || null, Sub1Name || null, parseInt(Order_Qty) || 0,
  amendedQty, finalQty, Amended_Shop || null
]);

console.log("✅ Inserted into Local DB tblorder_tran:", OrderNo);

    // ✅ Get `BoxTotalQty` from `tblpacks` based on `StockDescription`
    const mlMatch = StockDescription.match(/\d+/); // Extract ML value
    let BoxTotalQty = 0;

    if (mlMatch) {
      const packSize = parseFloat(mlMatch[0]); // Convert to number
      const packQuery = "SELECT QtyPerBox FROM tblpacks WHERE Packsize = ?";
      const [packResult] = await localPool.query(packQuery, [packSize]);

      if (packResult.length > 0) {
        BoxTotalQty = packResult[0].QtyPerBox || 0;
      }
    }

    // ✅ Auto-generate `BoxNo`
    const boxNoQuery = "SELECT COUNT(*) AS boxCount FROM tblorderboxinfo WHERE OrderNo = ?";
    const [boxResult] = await localPool.query(boxNoQuery, [OrderNo]);
    const BoxNo = (boxResult[0].boxCount || 0) + 1;

    // ✅ Insert into Local DB (tblorderboxinfo)
    if (StockCode) {
      const localBoxQuery = `
        INSERT INTO tblorderboxinfo (
          OrderNo, StockCode, BoxNo, BoxCodeQty, BoxTotalQty, DoneAndPrinted
        ) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      await localPool.query(localBoxQuery, [
        OrderNo, 
        StockCode, 
        BoxNo, 
        parseFloat(Order_Qty) || 0,  // ✅ BoxCodeQty = Order_Qty
        BoxTotalQty,  // ✅ BoxTotalQty = QtyPerBox from tblpacks
        0
      ]);

      console.log("✅ Inserted into Local DB tblorderboxinfo:", OrderNo);
    } else {
      console.log("⚠️ No valid StockCode provided, skipping tblorderboxinfo insert.");
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
        ot.Amended_Qty,
        obi.BoxNo,
        obi.BoxCodeQty,
        obi.BoxTotalQty,
        obi.DoneAndPrinted
    FROM tblorder o
    LEFT JOIN tblorder_tran ot ON o.OrderNo = ot.OrderNo
    LEFT JOIN tblorderboxinfo obi ON o.OrderNo = obi.OrderNo -- ✅ Added tblorderboxinfo
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
        ot.Amended_Qty,
        obi.BoxNo,
        obi.BoxCodeQty,
        obi.BoxTotalQty,
        obi.DoneAndPrinted
    FROM tblorder_tran ot
    LEFT JOIN tblorder o ON o.OrderNo = ot.OrderNo
    LEFT JOIN tblorderboxinfo obi ON ot.OrderNo = obi.OrderNo -- ✅ Join box info with transactions
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
  const { orderId, packedBy, amendedQty } = req.body; // Amended Qty added

  if (!orderId || !packedBy || !amendedQty) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const localPool = getDBPool(false); // Local DB
  const cloudPool = getDBPool(true); // Cloud DB

  try {
    // ✅ Step 1: Update Local DB (`tblorder` and `tblorder_tran`)
    const updatePackedQuery = `
      UPDATE tblorder 
      SET Order_Packed_By = ?, 
          Order_Packed_Date = NOW()
      WHERE OrderNo = ?
    `;

    await localPool.query(updatePackedQuery, [packedBy, amendedQty, orderId]);

    // ✅ Step 2: Update `tblorder_tran`
    const updateTransactionQuery = `
      UPDATE tblorder_tran 
      SET Amended_Qty = ? 
      WHERE OrderNo = ?
    `;

    await localPool.query(updateTransactionQuery, [amendedQty, orderId]);

    // ✅ Step 3: Sync with Cloud Database (`warehousemaster.tblorders`)
    const cloudUpdateQuery = `
      UPDATE warehousemaster.tblorders 
      SET Order_Packed_By = ?, 
          Amended_Qty = ?, 
          Order_Packed_Date = NOW() 
      WHERE OrderNo = ?
    `;

    await cloudPool.query(cloudUpdateQuery, [packedBy, amendedQty, orderId]);

    res.json({ message: "Order packed, amended quantity updated, and synced with cloud successfully" });

  } catch (error) {
    console.error("Packing Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/get-packed-orders", async (req, res) => {
  try {
    const localPool = getDBPool(false);

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
        ot.Order_Qty,  
        ot.Final_Qty,
        ot.Amended_Qty,
        obi.BoxNo,
        obi.BoxCodeQty,
        obi.BoxTotalQty 
      FROM tblorder o
      LEFT JOIN tblorder_tran ot ON o.OrderNo = ot.OrderNo
      LEFT JOIN tblorderboxinfo obi ON o.OrderNo = obi.OrderNo
      WHERE o.Order_Packed_By IS NOT NULL AND o.Order_Dispatch_By IS NULL
    `;

    const [results] = await localPool.query(query);

    res.json(results);
  } catch (err) {
    console.error("Error fetching packed orders:", err);
    res.status(500).json({ error: "Database error" });
  }
});

router.post("/dispatch-order", async (req, res) => {
  const { orderId, dispatchedBy, finalQty } = req.body;

  if (!orderId || !dispatchedBy || finalQty === undefined) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const localPool = getDBPool(false); // Local database connection
    const cloudPool = getDBPool(true);  // Cloud database connection

    // ✅ Update Local Database: tblorder (Dispatch Details)
    const [localOrderUpdate] = await localPool.query(
      `UPDATE tblorder 
       SET Order_Dispatch_By = ?, Order_Dispatched_Date = NOW() 
       WHERE OrderNo = ?`,
      [dispatchedBy, orderId]
    );

    if (localOrderUpdate.affectedRows === 0) {
      return res.status(404).json({ message: "Order not found in local DB" });
    }

    // ✅ Update Local Database: tblorder_tran (Final Qty)
    const [localFinalQtyUpdate] = await localPool.query(
      `UPDATE tblorder_tran 
       SET Final_Qty = ? 
       WHERE OrderNo = ?`,
      [finalQty, orderId]
    );

    if (localFinalQtyUpdate.affectedRows === 0) {
      console.warn("⚠️ Warning: Order not found in tblorder_tran for OrderNo:", orderId);
    }

    // ✅ Update Cloud Database
    const [cloudResult] = await cloudPool.query(
      `UPDATE warehousemaster.tblorders 
       SET Order_Dispatch_By = ?, Order_Dispatched_Date = NOW(), Final_Qty = ? 
       WHERE OrderNo = ?`,
      [dispatchedBy, finalQty, orderId]
    );

    if (cloudResult.affectedRows === 0) {
      console.error("❌ Order not found in cloud DB:", orderId);
      return res.status(404).json({ message: "Order not found in cloud DB" });
    }

    // ✅ Sync Shop Database
    await syncShopDB(orderId);

    res.json({ message: "Order dispatched successfully, FinalQty updated in all tables." });
  } catch (error) {
    console.error("Dispatch Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


router.get("/order-packing/:orderNo", async (req, res) => {
  const { orderNo } = req.params;
  const localPool = getDBPool(false);

  try {
    const query = `
  SELECT 
    o.OrderNo, 
    o.StockCode, 
    o.Order_Qty, 
    CAST(b.BoxNo AS CHAR) AS BoxNo,  -- ✅ Convert Buffer to String
    COALESCE(b.BoxTotalQty, 0) AS BoxTotalQty,
    p.QtyPerBox,
    o.StockDescription
FROM tblorder_tran o
LEFT JOIN tblorderboxinfo b 
    ON o.OrderNo = b.OrderNo 
    AND o.StockCode = b.StockCode
LEFT JOIN tblpacks p 
    ON o.StockDescription LIKE CONCAT('%', p.Packdescription, '%')
WHERE o.OrderNo = ?;

;
    `;
    const [rows] = await localPool.query(query, [orderNo]);

    res.json(rows);
  } catch (error) {
    console.error("Error fetching order packing data:", error);
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
