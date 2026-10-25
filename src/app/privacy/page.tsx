export default function Privacy() {
  return (
    <main className="guided">
      <a href="/">Back to Reach</a>
      <h1>Privacy and location</h1>
      <p>
        Find food, save places on your device, and submit food for review
        without an account. Administrator sign-in is reserved for reviewing
        submissions.
      </p>
      <h2>Your location and saved trips</h2>
      <p>
        “Use my location” asks your browser for permission. Accuracy varies; you
        can enter an address or coordinates instead. Your starting point stays
        in this browser session unless you explicitly include it in a saved
        trip. Bookmarks store a resource ID on this device. Clear saved items in
        Reach or clear browser site data to remove them. Downloaded files remain
        until you delete them.
      </p>
      <p>
        Address searches send the address to Reach and its configured geocoder.
        Requested routes send the selected origin, destination and mode to the
        routing provider. Map tiles connect your browser to the tile provider,
        which receives your IP address and map activity. Reverse-address lookup
        sends the selected coordinates to the geocoder. External Google Maps
        links open a separate service governed by its{" "}
        <a href="https://policies.google.com/privacy">privacy policy</a>.
      </p>
      <p>
        Route endpoints do not log precise coordinates, addresses, provider
        responses or keys. Responses use no-store; providers may use bounded
        server-memory caching to reduce duplicate requests. Hosting services may
        keep connection and access logs under their own policies.
      </p>
      <h2>AI assistance</h2>
      <p>
        When you leave AI enabled and submit a request, Reach sends that text,
        relevant public listing facts, approximate distances and comparison
        scores to the configured AI provider. Groq is the default; a site
        operator must configure credentials and accept its data policy. Do not
        include names, home addresses, contact details or other private
        information in your request.
      </p>
      <p>
        The ranking pipeline does not send your raw origin coordinates, private
        submission images or private household pickup instructions to AI. AI can
        explain recorded options but cannot verify food stock, eligibility or
        safe access. Turn off the AI checkbox to use directory search without an
        AI request. Provider policies apply; see{" "}
        <a href="https://console.groq.com/docs/your-data">
          Groq’s data controls
        </a>
        . The site may operate with AI unavailable, and directory results remain
        usable.
      </p>
      <h2>Sharing food and moderation</h2>
      <p>
        Submissions store your private name and email, consent confirmations,
        food details and optional photo for moderator review and abuse
        prevention. Only the contact information you explicitly choose to
        publish appears after approval. Household offers show a broad area, not
        your home address. Do not put private locations, faces or other people’s
        information in descriptions or photos. Photos are re-encoded to remove
        embedded metadata; visible landmarks or text may still reveal a place.
      </p>
      <p>
        When email delivery is configured, new-submission alerts go to
        reachpantrysupport@gmail.com with a link to the protected review page,
        not your private contact details or photos. Provider acceptance does not
        guarantee inbox delivery. Development preview saves messages privately
        on the server and sends no email. Submission success does not guarantee
        that an alert was delivered.
      </p>
      <p>
        Contact reachpantrysupport@gmail.com to request correction or removal.
        Submission and moderation records remain until an administrator removes
        them; there is no automatic deletion schedule. An optional
        developer-test image must be synthetic or fully redacted, never a real
        government ID. It does not verify identity. Test images are private,
        expire after 24 hours, and are removed from the active submission on
        approval or rejection.
      </p>
      <h2>Administrator access</h2>
      <p>
        Administrator records contain an email, password hash, permissions and
        private sessions. Passwords are never published. A password change signs
        out existing sessions. Review pages and uploaded submission images
        require authorized moderator access.
      </p>
      <h2>Directory corrections and crowd observations</h2>
      <p>
        Report factual listing problems with public sources, not private
        personal information. Correction reports are stored privately for up to
        90 days and never automatically change a listing. Rate limits do not
        store your IP address. Expired reports are removed on submission and
        scheduled maintenance; review and a response are not guaranteed.
      </p>
      <p>
        Crowd observations do not request your location. Time-slot totals may be
        used for up to 90 days. A pseudonymous duplicate-prevention key expires
        within 48 hours and is not published. Small groups and stale
        observations are suppressed. Historical patterns are not live occupancy.
      </p>
      <details>
        <summary>Retained older account-based services</summary>
        <p>
          Public registration, Google sign-in, account-based outreach and
          volunteer coordination are not offered in the current anonymous
          interface. Existing installations may retain older account and inquiry
          records. Completed inquiry history is removed after 30 days when the
          mail worker runs; private development-preview files require separate
          cleanup by the operator. Contact the operator to remove older records.
          These retained modules should not be treated as working public
          features.
        </p>
      </details>
    </main>
  );
}
