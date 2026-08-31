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
            <h1>Bạn gửi hơi nhanh</h1>
            <p>Hệ thống nhận được khá nhiều yêu cầu từ bạn trong ít phút vừa qua. Vui lòng đợi một chút rồi thử lại.</p>
            <p>Nếu bạn vừa đăng ký cho cả nhà, mỗi người chỉ cần gửi một lần — đăng ký sẽ không bị mất.</p>
            <p><a href="{{ url('/') }}">Về trang chủ</a></p>
        </main>
    </body>
</html>
