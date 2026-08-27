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

lint:
	$(COMPOSE) exec app ./vendor/bin/pint
	bun x biome check --write .

analyse:
	$(COMPOSE) exec app ./vendor/bin/phpstan analyse

shell:
	$(COMPOSE) exec app bash
