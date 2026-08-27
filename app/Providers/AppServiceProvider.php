<?php

namespace App\Providers;

use App\Support\HashedDatabaseSessionHandler;
use App\Support\TenantContext;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // scoped(), not singleton(): a fresh context per request lifecycle, so a
        // long-running test process (or Octane, ever) cannot leak one request's
        // shelf into the next.
        $this->app->scoped(TenantContext::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Laravel's database session store, keyed on sha256(session id)
        // instead of the raw id — see HashedDatabaseSessionHandler's
        // docstring for why the raw id must never reach the table.
        Session::extend('hashed-database', function (Application $app) {
            $config = $app->make('config');
            $db = $app->make('db');

            return new HashedDatabaseSessionHandler(
                $db->connection($config->get('session.connection')),
                $config->get('session.table', 'sessions'),
                $config->get('session.lifetime'),
                $app,
            );
        });
    }
}
