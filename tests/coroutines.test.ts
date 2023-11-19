import {
	co,
	component,
	type Coroutine,
	type Entity,
	field,
	System,
	type SystemType,
	World,
} from '../src';

let counter = 0;
let coroutine: () => Generator;
let wrapperHandle: Coroutine;
let coroutineHandle: Coroutine;

@component
class Foo {
	@field.int32 declare bar: number;
}

class StartCoroutine extends System {
	q = this.query((q) => q.using(Foo).read);

	initialize(): void {
		coroutineHandle = this.start(coroutine);
	}
}

class StartCoroutineTwice extends System {
	turn = 0;

	execute() {
		switch (this.turn++) {
			case 0:
			case 1:
				coroutineHandle = this.start(coroutine);
				break;
		}
	}
}

class StartNestedCoroutine extends System {
	initialize(): void {
		wrapperHandle = this.wrap();
	}

	@co *wrap() {
		counter += 1;
		const v = (yield (coroutineHandle = this.start(coroutine))) as number;
		counter += v;
	}
}

class CatchNestedCoroutine extends System {
	initialize(): void {
		this.wrap();
	}

	@co *wrap() {
		try {
			yield this.start(coroutine);
		} catch (e) {
			counter += 1;
		}
	}
}

class StartTwoCoroutines extends System {
	turn = 0;
	declare deco1: (routine: Coroutine) => void;
	declare deco2: (routine: Coroutine) => void;

	execute() {
		switch (this.turn++) {
			case 0:
				this.deco1(this.start(this.fn1));
				break;
			case 1:
				this.deco2(this.start(this.fn2));
				break;
		}
	}

	*fn1() {
		counter += 1;
		yield;
		counter += 1;
	}

	*fn2() {
		counter += 10;
		yield;
		counter += 10;
	}
}

function createWorld(...systems: SystemType<System>[] | any) {
	return World.create({
		maxEntities: 100,
		defaultComponentStorage: 'sparse',
		defs: systems,
	});
}

function sleep(seconds: number) {
	return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

beforeEach(() => {
	counter = 0;
});

describe('test running', () => {
	it('executes a coroutine', async () => {
		coroutine = function* () {
			counter += 1;
			yield;
		};
		const world = createWorld(StartCoroutine);
		world.execute();
		expect(counter).toBe(1);
	});

	it('propagates an exception', async () => {
		coroutine = function* () {
			throw new Error('foo');
			yield;
		};
		const world = createWorld(StartCoroutine);
		await expect(() => world.execute()).toThrow('foo');
	});

	it('executes a nested coroutine with return value', async () => {
		coroutine = function* () {
			counter += 1;
			yield;
			return 5;
		};
		const world = createWorld(StartNestedCoroutine);
		world.execute();
		expect(counter).toBe(2);
		world.execute();
		expect(counter).toBe(7);
	});

	it('propagates a nested exception', async () => {
		coroutine = function* () {
			throw new Error('foo');
			yield;
		};
		const world = createWorld(StartNestedCoroutine);
		// First execute starts wrapper, starts nested coroutine, and throws error.
		world.execute();
		// Second execute advances wrapper and rethrows the exception.
		expect(() => world.execute()).toThrow('foo');
	});

	it('catches a nested exception', async () => {
		coroutine = function* () {
			throw new Error('foo');
			yield;
		};
		const world = createWorld(CatchNestedCoroutine);
		world.execute();
		world.execute();
		expect(counter).toBe(1);
	});
});

describe('test waiting', () => {
	it('waits for the next frame on yield', async () => {
		coroutine = function* () {
			counter += 1;
			yield;
			counter += 1;
		};
		const world = createWorld(StartCoroutine);
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(2);
	});

	it('skips a frame', async () => {
		coroutine = function* () {
			counter += 1;
			yield co.waitForFrames(2);
			counter += 1;
		};
		const world = createWorld(StartCoroutine);
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(2);
	});

	it('waits for seconds', async () => {
		coroutine = function* () {
			counter += 1;
			yield co.waitForSeconds(0.05);
			counter += 1;
		};
		const world = createWorld(StartCoroutine);
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(1);
		await sleep(0.5);
		world.execute();
		expect(counter).toBe(2);
	});

	it('waits for condition', async () => {
		let resume = false;
		coroutine = function* () {
			counter += 1;
			yield co.waitUntil(() => resume);
			counter += 1;
		};
		const world = createWorld(StartCoroutine);
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(1);
		resume = true;
		world.execute();
		expect(counter).toBe(2);
	});
});

describe('test cancelling', () => {
	it('cancels a coroutine from outside', async () => {
		coroutine = function* () {
			counter += 1;
			yield;
			counter += 1;
		};
		const world = createWorld(StartCoroutine);
		world.execute();
		expect(counter).toBe(1);
		coroutineHandle.cancel();
		world.execute();
		expect(counter).toBe(1);
	});

	it('cancels a coroutine from inside', async () => {
		coroutine = function* () {
			counter += 1;
			co.cancel();
			yield;
			counter += 1;
		};
		const world = createWorld(StartCoroutine);
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(1);
	});

	it('cancels a nested coroutine from the top', async () => {
		coroutine = function* () {
			counter += 1;
			yield;
			counter += 2;
			return 5;
		};
		const world = createWorld(StartNestedCoroutine);
		world.execute();
		expect(counter).toBe(2);
		wrapperHandle.cancel();
		world.execute();
		expect(counter).toBe(2);
	});

	it('cancels a nested coroutine from the bottom, from outside', async () => {
		coroutine = function* () {
			counter += 1;
			yield;
			counter += 2;
			return 5;
		};
		const world = createWorld(StartNestedCoroutine);
		world.execute();
		expect(counter).toBe(2);
		coroutineHandle.cancel();
		world.execute();
		expect(counter).toBe(2);
	});

	it('cancels a nested coroutine from the bottom, from inside', async () => {
		coroutine = function* () {
			counter += 1;
			co.cancel();
			yield;
			counter += 2;
			return 5;
		};
		const world = createWorld(StartNestedCoroutine);
		world.execute();
		expect(counter).toBe(2);
		world.execute();
		expect(counter).toBe(2);
	});

	it('cancels a coroutine if a condition is true', async () => {
		let abort = false;
		coroutine = function* () {
			co.cancelIf(() => abort);
			counter += 1;
			yield;
			counter += 1;
		};
		const world = createWorld(StartCoroutine);
		world.execute();
		expect(counter).toBe(1);
		abort = true;
		world.execute();
		expect(counter).toBe(1);
	});

	it('cancels a coroutine if a condition is true when it is blocked on another', async () => {
		let abort = false;
		coroutine = function* () {
			counter += 1;
			yield;
			counter += 1;
			yield;
			return 5;
		};
		const world = createWorld(StartNestedCoroutine);
		wrapperHandle.cancelIf(() => abort);
		world.execute();
		expect(counter).toBe(2);
		abort = true;
		world.execute();
		expect(counter).toBe(2);
		world.execute();
		expect(counter).toBe(2);
	});

	it('cancels a scoped coroutine if the entity has been deleted', async () => {
		let entity: Entity;
		coroutine = function* () {
			counter += 1;
			yield;
			counter += 1;
		};
		const world = createWorld(StartCoroutine);
		world.build((sys) => {
			entity = sys.createEntity().hold();
			coroutineHandle.scope(entity);
		});
		world.execute();
		expect(counter).toBe(1);
		world.build((sys) => {
			entity.delete();
		});
		world.execute();
		expect(counter).toBe(1);
	});

	it('cancels a coroutine if a component has been removed', async () => {
		let entity: Entity;
		coroutine = function* () {
			counter += 1;
			yield;
			counter += 1;
		};
		const world = createWorld(StartCoroutine);
		world.build((sys) => {
			entity = sys.createEntity(Foo).hold();
			coroutineHandle.scope(entity).cancelIfComponentMissing(Foo);
		});
		world.execute();
		expect(counter).toBe(1);
		world.build((sys) => {
			entity.remove(Foo);
		});
		world.execute();
		expect(counter).toBe(1);
	});

	it('cancels a coroutine if started again', async () => {
		let entity: Entity;
		coroutine = function* () {
			co.scope(entity);
			co.cancelIfCoroutineStarted();
			while (true) {
				counter += 1;
				yield;
			}
		};
		const world = createWorld(StartCoroutineTwice);
		world.build((sys) => {
			entity = sys.createEntity().hold(); // eslint-disable-line @typescript-eslint/no-unused-vars
		});
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(2);
		world.execute();
		expect(counter).toBe(3);
		world.execute();
		expect(counter).toBe(4);
	});

	it('cancels a coroutine if another coroutine starts', async () => {
		const world = createWorld(StartTwoCoroutines, {
			deco1: (co1: Coroutine) => co1.cancelIfCoroutineStarted(),
			deco2: (co2: Coroutine) => co2,
		});
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(11);
		world.execute();
		expect(counter).toBe(21);
	});

	it('cancels a scoped coroutine if another coroutine with same scope starts', async () => {
		let entity: Entity;
		const world = createWorld(StartTwoCoroutines, {
			deco1: (co1: Coroutine) => co1.scope(entity).cancelIfCoroutineStarted(),
			deco2: (co2: Coroutine) => co2.scope(entity),
		});
		world.build((sys) => {
			entity = sys.createEntity().hold(); // eslint-disable-line @typescript-eslint/no-unused-vars
		});
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(11);
		world.execute();
		expect(counter).toBe(21);
	});

	it('does not cancel a scoped coroutine if another coroutine without scope starts', async () => {
		let entity: Entity;
		const world = createWorld(StartTwoCoroutines, {
			deco1: (co1: Coroutine) => co1.scope(entity).cancelIfCoroutineStarted(),
			deco2: (co2: Coroutine) => co2,
		});
		world.build((sys) => {
			entity = sys.createEntity().hold(); // eslint-disable-line @typescript-eslint/no-unused-vars
		});
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(12);
		world.execute();
		expect(counter).toBe(22);
	});

	it('cancels a coroutine if the given coroutine starts', async () => {
		const world = createWorld(StartTwoCoroutines, {
			deco1: (co1: Coroutine) =>
				co1.cancelIfCoroutineStarted(StartTwoCoroutines.prototype.fn2),
			deco2: (co2: Coroutine) => co2,
		});
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(11);
		world.execute();
		expect(counter).toBe(21);
	});

	it('does not cancel a coroutine if a coroutine other than given starts', async () => {
		const world = createWorld(StartTwoCoroutines, {
			deco1: (co1: Coroutine) =>
				co1.cancelIfCoroutineStarted(StartTwoCoroutines.prototype.fn1),
			deco2: (co2: Coroutine) => co2,
		});
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(12);
		world.execute();
		expect(counter).toBe(22);
	});

	it('does not cancel itself', async () => {
		const world = createWorld(StartTwoCoroutines, {
			deco1: (co1: Coroutine) => co1.cancelIfCoroutineStarted(),
			deco2: (co2: Coroutine) => co2.cancelIfCoroutineStarted(),
		});
		world.execute();
		expect(counter).toBe(1);
		world.execute();
		expect(counter).toBe(11);
		world.execute();
		expect(counter).toBe(21);
	});
});
