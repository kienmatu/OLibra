COMPOSE := docker compose -f docker-compose.laravel.yml
FILTER ?=

.PHONY: up down fresh test lint analyse shell

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

fresh:
	$(COMPOSE) exec app php artisan migrate:fresh --seed

test:
ifeq ($(FILTER),)
	$(COMPOSE) exec app php artisan test
else
	$(COMPOSE) exec app php artisan test --filter=$(FILTER)
endif

# The TypeScript step is here because CI runs it and `make lint` did not:
# .github/workflows/laravel.yml runs `bun run laravel:typecheck`, so a local
# run could be green on all three make targets while CI failed on a type
# error in resources/js. (Before phase 4, `bun run typecheck` was NOT this —
# it was `cd old_next && tsc`, checking the read-only reference. That reference
# is gone and the two now do the same thing.)
lint:
	$(COMPOSE) exec app ./vendor/bin/pint
	bun x biome check --write .
	bun run laravel:typecheck

analyse:
	$(COMPOSE) exec app ./vendor/bin/phpstan analyse

shell:
	$(COMPOSE) exec app bash
