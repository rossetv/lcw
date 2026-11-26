---
name: tests
description: How to write tests that earn their place - ones that can fail, that guard what matters and not ceremony, and that run fast and in parallel. Load before writing or changing tests in an LCW run.
user-invocable: false
---

# Tests that earn their place

A test exists to fail when the thing breaks. One that cannot fail, or that fails only when someone rewords a message, costs time on every run and guards nothing. Write few, and make each one count.

## What to test

- **What someone relies on.** What the requirement says must happen, and first of all what the spec says must never happen.
- **The edge that would hurt.** Empty, huge, twice, at the same time, half-written, and bad input from outside.
- **Every bug you fix.** The test that would have caught it, seen failing before the fix.
- **At the door people use.** The command, the API, the function other code calls. Not the private helper behind it.

## What not to test

- A one-line function said again in the test, a constant, a getter, a type.
- That a fake was called the way you just told it to be called.
- Exact wording or layout nobody relies on. Check the fact in the message, not the sentence.
- The language, the framework or a library.
- The same behaviour a second time through another door.

Coverage is not a goal. Ten tests that each guard something beat a hundred that mirror the code.

## Prove it can fail

- **See it fail.** Write the test first and watch it fail for the right reason. For a test written after the code, break the line it guards, watch it go red, and put the line back. A test you have never seen fail is unproven. An LCW worker follows its own instructions (agents/worker.md) on this: where the fix is already written, it does not put the old code back, and says in its report that the test was not seen failing.
- **Name the break.** For each test, say which mistake would make it fail. If you cannot, delete it.
- **One behaviour per test,** named as a sentence about the behaviour ("a paused run is not woken by the reset"), so that a failure reads as a fact.
- **Check outcomes, not insides:** what came back, what was written, what the person sees.
- **Real things where they are cheap:** a temporary folder, a real repository, a database in memory. Fake only what is slow, costs money or lives outside: the network, the clock, a model.

A failing test is fixed or reported. It is never deleted, skipped or loosened to get to green.

## Fast

A slow suite gets run less, and then it guards less. A unit test takes milliseconds and a part's own tests a few seconds.

- **Call the code, not the program.** Starting a process for each check is the usual thief. Keep one or two end-to-end tests for the wiring and test the rest through functions.
- **No real waiting.** No sleep and no real clock: pass the time in, and step it in the test. Start from a fixed instant, such as noon on a set date, in a fixed time zone where the code reads local time: never the current time, nor one worked out from it, which passes at noon and fails at night. Step it in as few moves as the test needs.
- **Build a fixture once** where the tests only read it; build it per test only where a test changes it.
- **Small cases.** Three inputs that differ in kind, not three hundred that differ in number.
- **Independent, so they can run in parallel.** Each test makes what it needs in its own temporary place and leaves nothing: no shared file, no fixed port, no reliance on order. Turn on the runner's parallel mode where the project allows it.
- **Run what your change can break** while you work: the tests of your own part. The milestone check runs the tests the milestone touched, and the suites the change can reach run once, in Review.
- **Measure.** A test that takes more than a second needs a reason. Say in your report how long your tests take.

## Before you say done

Every new test was seen failing. The suite takes no longer than it must, and you know the number. Nothing was skipped or weakened.
