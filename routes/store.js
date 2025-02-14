const express = require('express');
const router = express.Router();
const { getDBPool } = require('../db');
const db = require('../db');
const cloudPool = getDBPool(true); // ✅ Initialize Cloud DB Pool


// Fetch store orders from both cloud and local databases
router.get("/store-orders", async (req, res) => {
  const storeName = req.headers["store"]; // Fetch storeName from request headers

  let cloudConnection;
  let localConnection;

  try {
    const cloudPool = getDBPool(true); // Cloud DB connection
    const localPool = getDBPool(false); // Local DB connection

    // Get individual connections from the pool
    cloudConnection = await cloudPool.getConnection();
    localConnection = await localPool.getConnection();

    // Cloud DB query: Fetch all order details from tblorders (cloud) in one table
    const cloudOrderQuery = `
      SELECT 
        o.OrderNo, 
        o.StoreName, 
        o.OrderComplete, 
        o.Order_Approved_By, 
        o.Order_Approved_Date, 
        o.Order_Packed_By, 
        o.Order_Packed_Date, 
        o.Order_Dispatch_By, 
        o.Order_Dispatched_Date, 
        o.Order_Rcvd_Date, 
        o.Order_Approved_Date, 
        o.User,
        o.StockCode,
        LEFT(o.StockDescription, 256) AS StockDescription,
        o.MajorNo,
        o.MajorName,
        o.Sub1No,
        o.Sub1Name,
        o.Order_Qty,
        o.Rcvd_Qty,
        o.Amended_Qty,
        o.Final_Qty,
        o.Amended_Shop
      FROM 
        tblorders o
      WHERE 
        o.StoreName = ?
    `;
    const [cloudOrders] = await cloudConnection.query(cloudOrderQuery, [storeName]);
    console.log("✅ Fetched Orders for Store from Cloud DB:", storeName);

    // Local DB query: Fetch order details from tblorder and tblorder_tran (local)
    const localOrderQuery = `
      SELECT 
        o.OrderNo, 
        o.StoreName, 
        o.OrderComplete, 
        o.Order_Approved_By, 
        o.Order_Approved_Date, 
        o.Order_Packed_By, 
        o.Order_Packed_Date, 
        o.Order_Dispatch_By, 
        o.Order_Dispatched_Date, 
        o.Order_Rcvd_Date, 
        o.User,
        t.StockCode,
        LEFT(t.StockDescription, 256) AS StockDescription,
        t.MajorNo,
        t.MajorName,
        t.Sub1No,
        t.Sub1Name,
        t.Order_Qty,
        t.Rcvd_Qty,
        t.Amended_Qty,
        t.Final_Qty,
        t.Amended_Shop
      FROM 
        tblorder o
      LEFT JOIN 
        tblorder_tran t ON o.OrderNo = t.OrderNo
      WHERE 
        o.StoreName = ?
    `;
    const [localOrders] = await localConnection.query(localOrderQuery, [storeName]);
    console.log("✅ Fetched Orders for Store from Local DB:", storeName);

    // Combine cloud and local data (merge or prioritize based on requirements)
    const orders = [...cloudOrders, ...localOrders];

    // Respond with the combined orders
    res.status(200).json({ orders });
    
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({ message: "Error fetching orders", error: error.message });
  } finally {
    // Ensure connections are released in the finally block
    if (cloudConnection) {
      cloudConnection.release();
    }
    if (localConnection) {
      localConnection.release();
    }
  }
});
// API to update order status and received date
router.put('/update-order-status', async (req, res) => {
  const { OrderNo, status, receivedDate, receivedQty } = req.body; // Removed Amended_Qty

  let cloudConnection;
  let localConnection;

  try {
      const cloudPool = getDBPool(true);  // Cloud DB
      const localPool = getDBPool(false); // Local DB

      // Get connections from pool
      cloudConnection = await cloudPool.getConnection();
      localConnection = await localPool.getConnection();

      // Start transactions
      await cloudConnection.beginTransaction();
      await localConnection.beginTransaction();

      // ✅ Update `tblorders` (Cloud DB)
      const cloudOrderQuery = `
          UPDATE tblorders 
          SET Order_Rcvd_Date = NOW(), OrderComplete = 1, 
          Rcvd_Qty = ? 
          WHERE OrderNo = ?
      `;
      await cloudConnection.query(cloudOrderQuery, [status, receivedQty, OrderNo]); // ✅ Fixed parameter order

      // ✅ Update `tblorder` (Local DB)
      const localOrderQuery = `
          UPDATE tblorder 
          SET Order_Rcvd_Date = NOW(), OrderComplete = 1 
          WHERE OrderNo = ?
      `;
      await localConnection.query(localOrderQuery, [status, OrderNo]);

      // ✅ Update `tblorder_tran` (Local DB) - Received Qty
      const localOrderTranQuery = `
          UPDATE tblorder_tran 
          SET Rcvd_Qty = ? 
          WHERE OrderNo = ?
      `;
      await localConnection.query(localOrderTranQuery, [receivedQty, OrderNo]); // ✅ Fixed query params

      // ✅ Commit Transactions
      await cloudConnection.commit();
      await localConnection.commit();

      res.status(200).json({ message: 'Order status and received details updated successfully!' });

  } catch (error) {
      // ❌ Rollback on Error
      if (cloudConnection) await cloudConnection.rollback();
      if (localConnection) await localConnection.rollback();

      console.error('Error updating order status:', error);
      res.status(500).json({ message: 'Error updating order status', error: error.message });

  } finally {
      // ✅ Ensure connections are released
      if (cloudConnection) cloudConnection.release();
      if (localConnection) localConnection.release();
  }
});

;
router.post("/confirm-receipt", async (req, res) => {
  const { shopId, orderNo, receivedItems, receivedBy, invoiceNumber, supplierCode } = req.body;

  if (!shopId || !orderNo || !receivedItems || receivedItems.length === 0) {
    return res.status(400).json({ message: "Invalid request data" });
  }

  const connection = await cloudPool.getConnection();
  await connection.beginTransaction();

  try {
    // 🔹 Check if Order Exists
    const [orderExists] = await connection.query(
      `SELECT OrderNo FROM tblorders WHERE OrderNo = ?`, 
      [orderNo]
    );
    if (orderExists.length === 0) {
      return res.status(400).json({ message: "Order not found" });
    }

    // 🔹 Generate Unique GRV Number
    const grvNumber = `GRV-${Date.now()}`;

    // 🔹 Insert GRN Entry
    await connection.query(
      `INSERT INTO tbldata_grn (GRVNum, InvoiceNumber, InvoiceName, SupplierCode, DateTime) 
       VALUES (?, ?, ?, ?, NOW())`,
      [grvNumber, invoiceNumber, `Shop-${shopId}`, supplierCode]
    );

    let totalReceived = 0;
    let totalOrdered = 0;

    // 🔹 Insert GRN Details & Update Inventory
    for (const item of receivedItems) {
      totalReceived += item.receivedQty;
      totalOrdered += item.orderedQty || 0;

      await connection.query(
        `INSERT INTO tbldata_grn_det (
          DateTime, InvoiceNumber, TransactionNumber, StockCode, CreditorItemCode, Description, 
          QuantityReceived, BonusQuantity, QuantityOrdered, ExclusiveUnitCost, InclusiveUnitCost, 
          Markup, ExclusiveSelling, InclusiveSelling, VATPercentage, Discount1, Discount2, 
          DiscountCurrency, LineTotal, GRVNum, Shipping, Handling, Other, Subtotal, Discount, 
          VAT, SupplierCode, User, hisYear, hisMonth, hisDay, ShipSuppl, Comment
      ) 
         VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
          invoiceNumber, grvNumber, 
          item.stockCode || null, item.creditorItemCode || null, item.description || null, 
          item.receivedQty || 0, item.bonusQty || 0, item.orderedQty || 0, 
          item.exclusiveUnitCost || 0, item.inclusiveUnitCost || 0, item.markup || 0, 
          item.exclusiveSelling || 0, item.inclusiveSelling || 0, item.vatPercentage || 0, 
          item.discount1 || 0, item.discount2 || 0, item.discountCurrency || null, 
          item.lineTotal || 0, grvNumber, 
          item.shipping || 0, item.handling || 0, item.other || 0, item.subtotal || 0, 
          item.discount || 0, item.vat || 0, supplierCode, 
          receivedBy, item.hisYear || null, item.hisMonth || null, item.hisDay || null, 
          item.shipSuppl || null, item.comment || null
        ]
      );

      // 🔹 Update Stock Quantity in `tbl_product`
      await connection.query(
        `UPDATE tbl_product SET StockonHand = StockonHand + ? WHERE StockCode = ?`,
        [item.receivedQty, item.stockCode]
      );
    }

    // 🔹 Check if Order is Fully Received
    let orderComplete = totalReceived >= totalOrdered ? 1 : 0;

    // 🔹 Update Order Status
    await connection.query(
      `UPDATE tblorders SET OrderComplete = ? WHERE OrderNo = ?`,
      [orderComplete, orderNo]
    );

    await connection.commit();
    res.json({ message: "Stock receipt confirmed successfully", grvNumber });
  } catch (error) {
    await connection.rollback();
    console.error("Error processing stock receipt:", error);
    res.status(500).json({ message: "Error processing request", error: error.message });
  } finally {
    connection.release();
  }
});


module.exports = router;
