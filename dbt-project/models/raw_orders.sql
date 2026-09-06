select 1 as id, current_date as order_date, 1 as customer_id, 'East' as region, 100.00 as amount
union all
select 2, current_date, 2, 'East', 200.00
union all
select 3, current_date, 3, 'South', 50.00
