# Integration

Wire together multiple existing components that don't yet talk to each other.

## Design principles

- Provide 3-5 standalone components that each work independently but need to be connected.
- The model must understand each component's interface and write the glue code.
- Include type mismatches, protocol differences, and data format conversions that must be resolved.
- Tests verify the whole chain works end-to-end, not just individual components.
- Verification: run an end-to-end test that exercises the full integrated pipeline.
