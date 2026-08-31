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
        <style>
            /*
                Deliberately self-contained: no bundled stylesheet, no webfont,
                no CDN. An error page has to render when the rest of the app is
                already failing, so it must not depend on a built asset manifest
                or a third-party host. The colours below are the design system's
                `page`, `ink` and `meta` copied as literals for that reason, and
                the stack is a system one -- Vietnamese diacritics render
                correctly from system fonts on every target platform.

                Do not name the Vite directive in here, even in prose: Blade
                compiles its directives from inside CSS comments too, and an
                argument-less one throws a 500 out of the very page whose job is
                to render when everything else is broken. Watched happening.
            */
            body {
                margin: 0;
                display: flex;
                min-height: 100vh;
                align-items: center;
                justify-content: center;
                background: #fdfbf8;
                color: #3a352f;
                font-family:
                    system-ui,
                    -apple-system,
                    'Segoe UI',
                    Roboto,
                    'Helvetica Neue',
                    Arial,
                    sans-serif;
            }
            main {
                max-width: 28rem;
                padding: 2.5rem 2rem;
                text-align: center;
            }
            h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.75rem; }
            p { margin: 0 0 0.5rem; color: #716962; font-size: 0.95rem; line-height: 1.6; }
            a { color: #3a352f; font-weight: 500; text-underline-offset: 4px; }
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
