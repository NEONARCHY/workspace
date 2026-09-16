# Read-only bridge for the member registry

This bridge lets Workspace read the member registry without direct database access and without exposing MySQL credentials to desktop clients.

1. In cPanel MySQL Databases create a user that has **SELECT only** on `yuksal21_bot`.
2. Create a folder called `private` alongside `public_html`; it must not be inside `public_html`.
3. Copy `yuksalish-members-api.example.php` to `private/yuksalish-members-api.php`, then set the read-only database credentials and a new long random `sharedKey`.
4. Upload `workspace-members.php` to `public_html/workspace-members.php`.
5. In the Workspace server's `.env.lan`, add these values (do not commit that file):

   ```dotenv
   YUKSALISH_MEMBERS_API_URL=https://yuksalishbot.uz/workspace-members.php
   YUKSALISH_MEMBERS_INTEGRATION_KEY=the_same_sharedKey
   YUKSALISH_MEMBERS_CACHE_SECONDS=300
   ```

6. Run the normal Workspace deployment script. Sign in and open **Работа с членами**.

The endpoint accepts only signed server-to-server GET requests. It has no browser CORS access, no write SQL, and sends no database password to Workspace. If any secret was previously pasted into chat or committed, rotate it before configuring this bridge.
