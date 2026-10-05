SELECT SUM(insure_money) AS premium
FROM askdata_import.order_detail
WHERE YEAR(order_effective_time) = 2024
  AND insure_unit_province = CONVERT(UNHEX('E6B996E58C97E79C81') USING utf8mb4);

SELECT insure_unit_province AS province, SUM(insure_money) AS premium
FROM askdata_import.order_detail
WHERE YEAR(order_effective_time) = 2024
GROUP BY insure_unit_province
ORDER BY premium DESC
LIMIT 10;

SELECT product_line_name AS product_line, SUM(insure_money) AS premium
FROM askdata_import.order_detail
WHERE YEAR(order_effective_time) = 2024
GROUP BY product_line_name
ORDER BY premium DESC;
