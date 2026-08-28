<!--
    Fix round, Task 13, Important #4: companion to errors/429.blade.php.
    A 419 (TokenMismatchException, expired/missing CSRF token) is now
    reachable by a GUEST for the first time in this app's history —
    /register is the first unauthenticated write route, and a parish
    volunteer filling in a long form after the page has sat open past the
    session lifetime is exactly the person who trips this. Same reasoning
    as 429: no errors/419.blade.php existed, so this fell through to
    Laravel's stock English page; Laravel resolves this view automatically
    for the exception, no extra wiring required.
-->
<!DOCTYPE html>
<html lang="vi">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ config('app.name', 'OLibra') }} — Trang đã hết hạn</title>
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
            <h1>Trang đã hết hạn</h1>
            <p>Bạn để trang mở hơi lâu nên phiên làm việc đã hết hạn. Vui lòng quay lại và điền lại thông tin — rất tiếc, lần này bạn cần gửi lại từ đầu.</p>
            <p><a href="{{ url()->previous() }}">Quay lại</a></p>
        </main>
    </body>
</html>
