INSERT INTO fct_orders (order_date, customer_id, region, amount) VALUES
  (DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 DAY), 1, '华南', 1200.00),
  (DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 2 DAY), 2, '华东', 800.00),
  (DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 3 DAY), 3, '华北', 500.00),
  (CURDATE(), 4, '华南', 300.00);
