export default function Privacy() {
  return (
    <main className="guided">
      <a href="/">Back to Reach</a>
      <h1>Privacy and location</h1>
      <p>
        Finding resources does not require an account. Your starting location
        stays in this browser session unless you explicitly choose to include it
        in a saved trip on this device. Resource bookmarks save only a resource
        ID.
      </p>
      <p>
        “Use my location” asks your browser for permission. Browser accuracy
        varies. You can enter coordinates or an address instead.
      </p>
      <p>
        Address searches send the entered address to Reach’s server and the
        configured geocoding provider. After you request a route, Reach sends
        your selected origin, destination and travel mode to the configured
        routing provider. Changing those choices recalculates the route. Loading
        the interactive map connects your browser to the configured tile
        provider, which receives information such as your IP address and map
        activity.
      </p>
      <p>
        Reach’s route endpoints do not log request addresses, precise
        coordinates, provider responses or keys, and use no-store responses.
        Hosting services may keep ordinary connection and access logs under
        their own policies. Optional Google Maps links open a separate service
        governed by its{" "}
        <a href="https://policies.google.com/privacy">Privacy Policy</a>.
      </p>
      <p>
        The separate pantry planner saves a trip in browser storage only when
        you choose Save. Its saved plans use the selected named origin and trip
        details. Guided trips can include your precise starting point only with
        your explicit save consent. Use the Saved controls or clear browser site
        data to remove those saved plans.
      </p>
      <h2>Optional navigation assistance</h2>
      <p>
        Preference interpretation sends only the text you submit with the
        Interpret preferences button to the configured AI provider. Do not
        include addresses, names or contact details. Suggestions require your
        review. Optional AI guidance sends computed public trip timings and
        availability uncertainty, excluding your coordinates, private pickup
        details and profile. Provider privacy policies apply. Manual controls
        and computed explanations remain available without AI; AI cannot change
        service facts or feasibility.
      </p>
      <h2>Optional email accounts</h2>
      <p>
        You can also choose Google sign-in when configured. After you confirm,
        Google shares your name, email and stable Google account identifier.
        Reach stores the linked identifier and uses its existing private session
        cookie. Temporary sign-in state expires after ten minutes; Google access
        and refresh tokens are not saved. Reach does not request Gmail read or
        send permissions. Approved pantry inquiries are sent by Reach’s email
        provider, not through your Gmail account.
      </p>
      <p>
        Google sign-in and pantry email consent are separate. Existing accounts
        are never merged automatically by email. You can link Google while
        signed in to your Reach account, or disconnect it after confirming your
        Reach password. Google-only accounts can set a password through email
        recovery when Reach email delivery is available. You can remove Google’s
        saved permission in your Google account connections. Google’s own
        privacy policy applies to sign-in; third-party email addresses may still
        need separate verification in Reach.
      </p>
      <p>
        An account stores your email, name, password hash, verification status,
        sessions, chosen preferences and favorite pantry IDs. Saving a preferred
        location requires explicit consent; it is private to your account and
        removable in Account settings. Verification and recovery emails go
        through the configured email provider. Passwords and email tokens are
        not shown publicly.
      </p>
      <p>
        Deleting your account requires your password and removes your private
        locations, favorites and community content. Pantry correction and audit
        history can remain with your account reference removed. Downloaded files
        and trips saved on your device remain until you delete them yourself.
      </p>
      <h2>Email notifications and volunteer pickups</h2>
      <p>
        Pantry, pickup and volunteer emails are optional and off until you opt
        in. Change these choices in Account settings or use an unsubscribe link.
        Essential verification and account-security messages remain separate.
        Emails contain a general update and a sign-in link, not private pickup
        instructions or precise locations. We do not add email-open or click
        tracking.
      </p>
      <p>
        When sending is enabled, the configured mail provider receives your
        email address and message. Reach keeps delivery status and error codes;
        accepted delivery does not guarantee inbox placement. Account deletion
        removes queued notifications and disconnects retained delivery records
        from your account. Development preview mode sends nothing and saves
        message files privately on the development server. Those files may
        contain one-use account links and must be deleted after testing, never
        published or included in downloads.
      </p>
      <p>
        Volunteer participation is optional. Only an assigned volunteer with
        pickup consent can access a donor’s shared private instructions. A claim
        records coordination, not a guarantee that food or transport will be
        available.
      </p>
      <h2>Food access planning and availability inquiries</h2>
      <p>
        The food-access planner uses your selected starting point for requested
        routes but does not save that origin to your account. Optional AI
        preference assistance sends only the text you submit to the configured
        inference provider after the operator enables it and accepts its data
        policy. Avoid names, addresses and sensitive circumstances in that text.
        Structured controls work without AI.
      </p>
      <p>
        Availability inquiries require a verified account and your review before
        sending. Only participating organization contacts and enrolled household
        donors can receive them. The recipient and mail provider receive the
        reviewed message, not your starting location. Reach stores private
        inquiry messages, replies, extracted facts and delivery status for your
        history. Completed inquiries are removed after 30 days when the mail
        worker runs. Development preview files require separate cleanup.
      </p>
      <p>
        Replies are untrusted sender reports. If AI extraction is enabled, only
        necessary reply text goes to the configured provider. Review is required
        before a reply changes your private options; it does not update public
        pantry records. Precise household pickup coordinates are stored only
        when you explicitly confirm permission to save them for an accepted
        pickup. You can cancel pending inquiries and optional follow-ups, and
        enrolled donors can stop inquiries. Deleting your account removes its
        private inquiry history.
      </p>
      <h2>Optional crowd observations</h2>
      <p>
        Reporting does not request or track your location. Reports become pantry
        time-slot totals used for up to 90 days. Expired records are removed
        during crowd requests and scheduled maintenance. A short-lived
        pseudonymous key prevents duplicate reports for a pantry and day and
        expires within 48 hours; it is not published. Small groups and stale
        observations are suppressed. Aggregates do not identify people receiving
        food and remain after account deletion. Historical patterns are not
        current occupancy.
      </p>
      <h2>Community food sharing</h2>
      <p>
        Community submissions require an adult account. Reach stores your
        username, salted password hash, session record, submissions, pickup
        requests, reports and moderation history. Food offers show only a broad
        public area. Never put a home address, phone number or private location
        in a public description or photo.
      </p>
      <p>
        Private pickup instructions are shared with an accepted recipient only
        after both people consent. Choose a public meeting place. Uploaded
        photos are re-encoded to remove embedded location metadata; visible text
        and landmarks in a photo can still identify a place. Blocking, reporting
        and canceling are available in Community. Email account recovery depends
        on the configured mail service; community-only username accounts can
        attach and verify an email from Account settings. Community sharing has
        no public service guarantee.
      </p>
      <p>
        Provider requests and responses may be cached briefly in bounded server
        memory to avoid duplicate requests. Precise preferred locations are
        stored in your account only if you explicitly save them with consent.
        Explicit reverse-address lookup sends only the selected coordinates to
        the geocoder. Published pantry facts and their source records are
        maintained separately.
      </p>
    </main>
  );
}
