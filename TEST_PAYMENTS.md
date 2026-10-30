# Mock QR payment testing

Enable `TEST_PAYMENTS_ENABLED=1` in Render Environment and deploy the latest commit. Development enables this by default; set `TEST_PAYMENTS_ENABLED=0` to disable it. The startup migration creates a separate `mock_payments` table. Local upgrades: `python -m flask --app run db upgrade` from backend.

Complete a trip, open the rider's completed ride or ride history, and select **Pay by QR (test)**. Scan using a phone camera or open the test page link. Select success, failed, or pending. Rider, assigned driver, and admin see the result on the ride card on the next workspace poll (up to 15 seconds). Refreshing also retrieves it.

Every screen labels this **TEST PAYMENT — no money transferred**. There is no bank/UPI integration, actual payment receipt, refund, or change to earnings allocations. A successful mock result remains successful on retries, concurrent scans, or later failed/pending requests. One record is stored per completed ride using the locked fare amount.

QR links are temporary bearer capabilities: anyone with the link can simulate that one test payment for 15 minutes without signing in. They disclose only amount, currency, and test status. Do not share links publicly. Expired links require generating a new QR from the rider workspace. Turning the feature off blocks all simulation endpoints; recorded test status remains visible on ride history. A phone must reach the application URL; localhost QR links only work on the same computer. Use the Render HTTPS URL for phone testing.
