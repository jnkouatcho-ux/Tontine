
DO $$
DECLARE
  t_rec RECORD;
  month_start DATE;
  last_day DATE;
  dow INT;
  nth_date DATE;
  week_number INT;
  dates_arr DATE[];
  order_num INT;
BEGIN
  FOR t_rec IN
    SELECT DISTINCT es.tontine_id,
           t.start_date::DATE AS start_dt,
           t.end_date::DATE   AS end_dt,
           (t.periodicity_detail->>'weekNumber')::INT AS week_num
    FROM eating_schedule es
    JOIN tontines t ON t.id = es.tontine_id
    WHERE t.periodicity_type = 'monthly'
  LOOP
    week_number := t_rec.week_num;
    dates_arr   := ARRAY[]::DATE[];
    month_start := DATE_TRUNC('month', t_rec.start_dt)::DATE;

    WHILE month_start <= t_rec.end_dt LOOP

      IF week_number = 5 THEN
        -- Last Sunday of the month
        last_day := (month_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
        dow      := EXTRACT(DOW FROM last_day)::INT;   -- 0 = Sunday
        nth_date := (last_day - (dow * INTERVAL '1 day'))::DATE;
      ELSE
        -- Nth Sunday (1–4)
        dow      := EXTRACT(DOW FROM month_start)::INT;
        nth_date := (month_start + (((7 - dow) % 7) * INTERVAL '1 day') + ((week_number - 1) * 7 * INTERVAL '1 day'))::DATE;
        IF EXTRACT(MONTH FROM nth_date) <> EXTRACT(MONTH FROM month_start) THEN
          nth_date := NULL;
        END IF;
      END IF;

      IF nth_date IS NOT NULL
         AND nth_date >= t_rec.start_dt
         AND nth_date <= t_rec.end_dt
      THEN
        dates_arr := array_append(dates_arr, nth_date);
      END IF;

      month_start := (month_start + INTERVAL '1 month')::DATE;
    END LOOP;

    -- Update each entry with the correct date
    FOR order_num IN 1 .. array_length(dates_arr, 1) LOOP
      UPDATE eating_schedule
      SET scheduled_date = dates_arr[order_num]
      WHERE tontine_id = t_rec.tontine_id
        AND order_number = order_num;
    END LOOP;

  END LOOP;
END $$;
