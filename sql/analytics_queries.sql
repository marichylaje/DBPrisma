-- Daily active users
SELECT
  DATE("occurredAt") AS day,
  COUNT(DISTINCT "userKey") AS dau
FROM "AnalyticsEvent"
WHERE "eventName" = 'session_started'
GROUP BY 1
ORDER BY 1 DESC;

-- Weekly active users
SELECT
  DATE_TRUNC('week', "occurredAt") AS week_start,
  COUNT(DISTINCT "userKey") AS wau
FROM "AnalyticsEvent"
WHERE "eventName" = 'session_started'
GROUP BY 1
ORDER BY 1 DESC;

-- Monthly active users
SELECT
  DATE_TRUNC('month', "occurredAt") AS month_start,
  COUNT(DISTINCT "userKey") AS mau
FROM "AnalyticsEvent"
WHERE "eventName" = 'session_started'
GROUP BY 1
ORDER BY 1 DESC;

-- D1 retention
WITH first_seen AS (
  SELECT
    "userKey",
    MIN(DATE("occurredAt")) AS cohort_day
  FROM "AnalyticsEvent"
  WHERE "eventName" = 'session_started'
  GROUP BY 1
),
returns AS (
  SELECT DISTINCT
    fs."userKey",
    fs.cohort_day,
    DATE(ae."occurredAt") AS active_day
  FROM first_seen fs
  JOIN "AnalyticsEvent" ae
    ON ae."userKey" = fs."userKey"
   AND ae."eventName" = 'session_started'
)
SELECT
  cohort_day,
  COUNT(*) FILTER (WHERE active_day = cohort_day + INTERVAL '1 day') AS returned_d1,
  COUNT(*) FILTER (WHERE active_day = cohort_day + INTERVAL '7 day') AS returned_d7,
  COUNT(*) FILTER (WHERE active_day = cohort_day) AS cohort_size,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE active_day = cohort_day + INTERVAL '1 day')
    / NULLIF(COUNT(*) FILTER (WHERE active_day = cohort_day), 0),
    2
  ) AS d1_retention_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE active_day = cohort_day + INTERVAL '7 day')
    / NULLIF(COUNT(*) FILTER (WHERE active_day = cohort_day), 0),
    2
  ) AS d7_retention_pct
FROM returns
GROUP BY 1
ORDER BY 1 DESC;

-- Screen usage and average time
SELECT
  COALESCE("screenName", 'unknown') AS screen_name,
  COUNT(*) FILTER (WHERE "eventName" = 'screen_viewed') AS views,
  ROUND(
    AVG(
      CASE
        WHEN "eventName" = 'screen_exited'
        THEN NULLIF(("properties"->>'durationMs')::numeric, 0)
      END
    ) / 1000.0,
    2
  ) AS avg_seconds
FROM "AnalyticsEvent"
WHERE "eventName" IN ('screen_viewed', 'screen_exited')
GROUP BY 1
ORDER BY views DESC;

-- Top CTA clicks
SELECT
  COALESCE("screenName", 'unknown') AS screen_name,
  COALESCE("properties"->>'ctaName', 'unknown') AS cta_name,
  COUNT(*) AS clicks
FROM "AnalyticsEvent"
WHERE "eventName" = 'screen_cta_clicked'
GROUP BY 1, 2
ORDER BY clicks DESC;

-- Wishlist usage and external purchase intent
SELECT
  DATE("occurredAt") AS day,
  COUNT(*) FILTER (WHERE "eventName" = 'wishlist_card_added') AS cards_added,
  COUNT(*) FILTER (WHERE "eventName" = 'wishlist_purchase_link_opened') AS purchase_link_opens,
  COUNT(DISTINCT "userKey") FILTER (WHERE "eventName" = 'wishlist_purchase_link_opened') AS buyers_intent_users
FROM "AnalyticsEvent"
GROUP BY 1
ORDER BY 1 DESC;

-- Modal friction by modal name
SELECT
  COALESCE("properties"->>'modalName', 'unknown') AS modal_name,
  COUNT(*) FILTER (WHERE "eventName" = 'modal_opened') AS opened,
  COUNT(*) FILTER (WHERE "eventName" = 'modal_confirmed') AS confirmed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE "eventName" = 'modal_confirmed')
    / NULLIF(COUNT(*) FILTER (WHERE "eventName" = 'modal_opened'), 0),
    2
  ) AS confirm_rate_pct
FROM "AnalyticsEvent"
WHERE "eventName" IN ('modal_opened', 'modal_confirmed')
GROUP BY 1
ORDER BY opened DESC;

-- Empty states and no-result searches
SELECT
  "eventName",
  COALESCE("screenName", 'unknown') AS screen_name,
  COALESCE("properties"->>'stateName', "properties"->>'query', 'unknown') AS detail,
  COUNT(*) AS total
FROM "AnalyticsEvent"
WHERE "eventName" IN ('empty_state_viewed', 'search_returned_no_results')
GROUP BY 1, 2, 3
ORDER BY total DESC;

-- Deck creation/import/improve funnel summary
SELECT
  "eventName",
  COUNT(*) AS total_events,
  COUNT(DISTINCT "userKey") AS unique_users
FROM "AnalyticsEvent"
WHERE "eventName" IN (
  'deck_creation_started',
  'deck_saved',
  'deck_auto_generation_requested',
  'deck_improvement_requested',
  'flow_step_completed'
)
GROUP BY 1
ORDER BY total_events DESC;

-- Scanner reliability
SELECT
  DATE("occurredAt") AS day,
  COUNT(*) FILTER (WHERE "eventName" = 'scanner_opened') AS scanner_opened,
  COUNT(*) FILTER (WHERE "eventName" = 'scanner_card_detected') AS cards_detected,
  COUNT(*) FILTER (WHERE "eventName" = 'scanner_detection_failed') AS detection_failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE "eventName" = 'scanner_card_detected')
    / NULLIF(COUNT(*) FILTER (WHERE "eventName" = 'scanner_card_detected') + COUNT(*) FILTER (WHERE "eventName" = 'scanner_detection_failed'), 0),
    2
  ) AS detection_success_pct
FROM "AnalyticsEvent"
GROUP BY 1
ORDER BY 1 DESC;

-- Tournament usage
SELECT
  "eventName",
  COUNT(*) AS total_events,
  COUNT(DISTINCT "userKey") AS unique_users
FROM "AnalyticsEvent"
WHERE "eventName" IN ('tournament_opened', 'tournament_created', 'tournament_joined')
GROUP BY 1
ORDER BY total_events DESC;

-- Error monitoring
SELECT
  DATE("occurredAt") AS day,
  "eventName",
  COUNT(*) AS total
FROM "AnalyticsEvent"
WHERE "eventName" IN ('api_request_failed', 'ui_render_error', 'app_fatal_error')
GROUP BY 1, 2
ORDER BY 1 DESC, total DESC;
