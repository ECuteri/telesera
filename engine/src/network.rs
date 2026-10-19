use grammers_client::{sender::SenderPoolFatHandle, tl};
use std::time::Duration;

// A hotspot can discard its NAT state while Linux still considers the old TCP
// sockets established. A bounded round trip detects that silent failure.
pub async fn maintain(pool: SenderPoolFatHandle) {
    let mut ticks = tokio::time::interval(Duration::from_secs(30));
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut ping_id = 0;
    loop {
        ticks.tick().await;
        let Ok(dc) = pool.session.home_dc_id() else {
            continue;
        };
        ping_id += 1;
        let ping = tl::functions::Ping { ping_id };
        if tokio::time::timeout(Duration::from_secs(12), pool.invoke_in_dc(dc, &ping))
            .await
            .is_err()
        {
            // Keep authorization and let the next request open fresh sockets.
            // Media connections share the same broken network, so drop those too.
            for id in 1..=5 {
                pool.disconnect_from_dc(id);
            }
            if !(1..=5).contains(&dc) {
                pool.disconnect_from_dc(dc);
            }
            eprintln!("Telegram connection timed out; reconnecting transports");
        }
    }
}
