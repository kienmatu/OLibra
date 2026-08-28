<!--
    Fix round, Task 13, Important #4: no error/{code}.blade.php existed at
    all, so any HTTP exception — this one included — fell through to
    Laravel's own stock English page. `throttle:register` is the FIRST
    guest-reachable route in this app that can genuinely trip a 429 (every
    other rate limiter guards an authenticated action), so a throttled
    family on a Vietnamese-first public form was the single most likely
    person to ever see a raw English "Too Many Requests" page. Laravel's
    default exception handler resolves resources/views/errors/{status}.blade.php
    for an HttpException automatically — no extra registration needed —
    so dropping this file in is the whole fix.

    Deliberately a plain Blade view, not an Inertia page: the exception is
    thrown by route middleware, before any controller ever gets to call
    Inertia::render(), so there is no Inertia response to render into.
-->
<!DOCTYPE html>
<html lang="vi">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ config('app.name', 'OLibra') }} — Vui lòng thử lại sau</title>
        <link rel="preconnect" href="https://fonts.bunny.net">
        <link href="https://fonts.bunny.net/css?family=instrument-sans:400,500,600" rel="stylesheet">
        <style>
            body {
                margin: 0;
                display: flex;
                min-height: 100vh;
                align-items: center;
                justify-content: center;
                background: #fafafa;
                color: #18181b;
                font-family: 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
            }
            main {
                max-width: 28rem;
                padding: 2.5rem 2rem;
                text-align: center;
            }
            h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.75rem; }
            p { margin: 0 0 0.5rem; color: #52525b; font-size: 0.95rem; line-height: 1.6; }
            a { color: #18181b; font-weight: 500; text-underline-offset: 4px; }
        </style>
    </head>
    <body>
        <main>
            <h1>Bạn gửi hơi nhanh</h1>
            <p>Hệ thống nhận được khá nhiều yêu cầu từ bạn trong ít phút vừa qua. Vui lòng đợi một chút rồi thử lại.</p>
            <p>Nếu bạn vừa đăng ký cho cả nhà, mỗi người chỉ cần gửi một lần — đăng ký sẽ không bị mất.</p>
            <p><a href="{{ url('/') }}">Về trang chủ</a></p>
        </main>
    </body>
</html>
