import { System, World, field } from '../src';

class A {
	@field.int32 declare value: number;
}

class SysA extends System {}

class SysB extends System {
	sched = this.schedule((s) => s.after(SysA));
}

class SysC extends System {
	sched = this.schedule((s) => s.after(SysA));
}

beforeEach(() => {
	// This bypasses the exception made for tests that allows components to be reused across worlds.
	process.env.NODE_ENV = 'development';
});

afterEach(() => {
	process.env.NODE_ENV = 'test';
});

describe('world creation', () => {
	test('duplicate component types', async () => {
		World.create({ defs: [A, A] }).terminate();
	});

	test('duplicate systems', async () => {
		World.create({ defs: [SysA, SysA] }).terminate();
	});

	test('duplicate systems with props first', async () => {
		World.create({ defs: [SysA, { foo: 'bar' }, SysA] }).terminate();
	});

	test('duplicate systems with props second', async () => {
		World.create({ defs: [SysA, SysA, { foo: 'bar' }] }).terminate();
	});

	test('duplicate systems with duplicate props', async () => {
		expect(() =>
			World.create({ defs: [SysA, { foo: 'bar' }, SysA, { foo: 'bar' }] }),
		).toThrow();
	});

	test('worlds cannot share components', async () => {
		const world1 = World.create({ defs: [A] });
		expect(() => World.create({ defs: [A] })).toThrow(
			'Component type A is already in use in another world',
		);
		world1.terminate();
	});
});

describe('world destruction', () => {
	test('terminate world with multiple systems', async () => {
		process.env.NODE_ENV = 'test';
		const world = World.create({ defs: [SysA, SysB, SysC] });
		world.terminate();
	});

	test('terminate world then create another one with same components', async () => {
		let world = World.create({ defs: [A] });
		world.terminate();
		world = World.create({ defs: [A] });
		world.terminate();
	});
});
