//! Testing v2 — Scenario 04: Doubly linked list
//!
//! Two-file Python doubly linked list with iterator support.
//! The model must write tests exercising the API per the docstrings.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let node_file = ap(dir, "node.py");
        std::fs::write(&node_file, r#"class _Node:
    """Internal node for the doubly linked list.

    Each node stores a value and references to the previous and next nodes.
    """

    __slots__ = ('value', 'prev', 'next')

    def __init__(self, value, prev=None, next=None):
        self.value = value
        self.prev = prev
        self.next = next

    def __repr__(self):
        pv = self.prev.value if self.prev else None
        nv = self.next.value if self.next else None
        return f"_Node({self.value!r}, prev={pv!r}, next={nv!r})"
"#).unwrap();

        let dll_file = ap(dir, "linkedlist.py");
        std::fs::write(&dll_file, r#"from node import _Node


class DoublyLinkedList:
    """A doubly linked list supporting O(1) append/prepend and O(n) lookup.

    Maintains _head and _tail pointers. Supports iteration, reversal,
    and a take_while() method.

    >>> dll = DoublyLinkedList()
    >>> dll.append(1)
    >>> dll.append(2)
    >>> dll.append(3)
    >>> list(dll)
    [1, 2, 3]
    >>> dll.remove(2)
    >>> list(dll)
    [1, 3]
    """

    def __init__(self):
        self._head = None
        self._tail = None
        self._size = 0

    def append(self, value):
        """Add a value to the end of the list."""
        node = _Node(value, prev=self._tail)
        if self._tail:
            self._tail.next = node
        else:
            self._head = node
        self._tail = node
        self._size += 1

    def prepend(self, value):
        """Add a value to the beginning of the list."""
        node = _Node(value, next=self._head)
        if self._head:
            self._head.prev = node
        else:
            self._tail = node
        self._head = node
        self._size += 1

    def remove(self, value):
        """Remove the first occurrence of value. Raises ValueError if not found."""
        curr = self._head
        while curr:
            if curr.value == value:
                if curr.prev:
                    curr.prev.next = curr.next
                else:
                    self._head = curr.next
                if curr.next:
                    curr.next.prev = curr.prev
                self._size -= 1
                return
            curr = curr.next
        raise ValueError(f"{value!r} not in list")

    def reverse(self):
        """Reverse the list in place.

        After reversal, _head points to what was the last element
        and _tail points to what was the first element.
        Iteration order is reversed.

        >>> dll = DoublyLinkedList()
        >>> for x in [1, 2, 3]: dll.append(x)
        >>> dll.reverse()
        >>> list(dll)
        [3, 2, 1]
        """
        curr = self._head
        while curr:
            curr.prev, curr.next = curr.next, curr.prev
            curr = curr.prev
        self._head, self._tail = self._tail, self._head

    def take_while(self, predicate):
        """Return a list of values from the head while predicate(value) is true.

        Stops at the first element where predicate returns False.
        Does NOT include that element.

        >>> dll = DoublyLinkedList()
        >>> for x in [1, 2, 3, 4, 5]: dll.append(x)
        >>> dll.take_while(lambda x: x < 4)
        [1, 2, 3]
        """
        result = []
        curr = self._head
        while curr:
            if not predicate(curr.value):
                break
            result.append(curr.value)
            curr = curr.next
        return result

    def __iter__(self):
        curr = self._head
        while curr:
            yield curr.value
            curr = curr.next

    def __len__(self):
        return self._size

    def __contains__(self, value):
        return any(v == value for v in self)

    def to_list(self):
        """Return all values as a Python list."""
        return list(self)
"#).unwrap();

        // Buggy version: remove() doesn't update _tail, reverse() doesn't swap head/tail,
        // take_while() includes one extra element
        let dll_buggy = ap(dir, "linkedlist_buggy.py");
        std::fs::write(&dll_buggy, r#"from node import _Node


class DoublyLinkedList:
    """A doubly linked list supporting O(1) append/prepend and O(n) lookup.

    Maintains _head and _tail pointers. Supports iteration, reversal,
    and a take_while() method.

    >>> dll = DoublyLinkedList()
    >>> dll.append(1)
    >>> dll.append(2)
    >>> dll.append(3)
    >>> list(dll)
    [1, 2, 3]
    >>> dll.remove(2)
    >>> list(dll)
    [1, 3]
    """

    def __init__(self):
        self._head = None
        self._tail = None
        self._size = 0

    def append(self, value):
        """Add a value to the end of the list."""
        node = _Node(value, prev=self._tail)
        if self._tail:
            self._tail.next = node
        else:
            self._head = node
        self._tail = node
        self._size += 1

    def prepend(self, value):
        """Add a value to the beginning of the list."""
        node = _Node(value, next=self._head)
        if self._head:
            self._head.prev = node
        else:
            self._tail = node
        self._head = node
        self._size += 1

    def remove(self, value):
        """Remove the first occurrence of value. Raises ValueError if not found."""
        curr = self._head
        while curr:
            if curr.value == value:
                if curr.prev:
                    curr.prev.next = curr.next
                else:
                    self._head = curr.next
                if curr.next:
                    curr.next.prev = curr.prev
                self._size -= 1
                return
            curr = curr.next
        raise ValueError(f"{value!r} not in list")

    def reverse(self):
        """Reverse the list in place.

        After reversal, _head points to what was the last element
        and _tail points to what was the first element.
        Iteration order is reversed.

        >>> dll = DoublyLinkedList()
        >>> for x in [1, 2, 3]: dll.append(x)
        >>> dll.reverse()
        >>> list(dll)
        [3, 2, 1]
        """
        curr = self._head
        while curr:
            curr.prev, curr.next = curr.next, curr.prev
            curr = curr.prev

    def take_while(self, predicate):
        """Return a list of values from the head while predicate(value) is true.

        Stops at the first element where predicate returns False.
        Does NOT include that element.

        >>> dll = DoublyLinkedList()
        >>> for x in [1, 2, 3, 4, 5]: dll.append(x)
        >>> dll.take_while(lambda x: x < 4)
        [1, 2, 3]
        """
        result = []
        curr = self._head
        while curr:
            result.append(curr.value)
            if not predicate(curr.value):
                break
            curr = curr.next
        return result

    def __iter__(self):
        curr = self._head
        while curr:
            yield curr.value
            curr = curr.next

    def __len__(self):
        return self._size

    def __contains__(self, value):
        return any(v == value for v in self)

    def to_list(self):
        """Return all values as a Python list."""
        return list(self)
"#).unwrap();

        // Fixed version
        let dll_fixed = ap(dir, "linkedlist_fixed.py");
        std::fs::write(&dll_fixed, std::fs::read_to_string(&dll_file).unwrap()).unwrap();

        let runner = ap(dir, "run_tests.py");
        std::fs::write(&runner, r#"import subprocess, sys, os, shutil

test_file = None
for f in sorted(os.listdir(".")):
    if f.startswith("test_") and f.endswith(".py") and f != "run_tests.py":
        test_file = f
        break

if test_file is None:
    print("NO_TEST_FILE_FOUND")
    sys.exit(1)

def swap_and_run(label, src_file):
    shutil.copy(src_file, "linkedlist.py")
    shutil.rmtree('__pycache__', ignore_errors=True)
    return subprocess.run(
        [sys.executable, '-B', test_file],
        capture_output=True, text=True, timeout=30
    )

buggy_result = swap_and_run("BUGGY", "linkedlist_buggy.py")
buggy_failed = buggy_result.returncode != 0 or "ALL_TESTS_PASSED" not in buggy_result.stdout

fixed_result = swap_and_run("FIXED", "linkedlist_fixed.py")
fixed_passed = fixed_result.returncode == 0 and "ALL_TESTS_PASSED" in fixed_result.stdout

if buggy_failed and fixed_passed:
    print("ALL_TESTS_PASSED")
elif not buggy_failed:
    print(f"FAIL: tests did not catch any bugs in buggy code")
    print(f"stdout: {buggy_result.stdout[-500:]}")
else:
    print(f"FAIL: tests fail on corrected code too")
    print(f"stdout: {fixed_result.stdout[-500:]}")
    print(f"stderr: {fixed_result.stderr[-500:]}")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The doubly linked list in {} and {} may have bugs. \
             Your task is to write a comprehensive test file `test_linkedlist.py` \
             that tests the DoublyLinkedList class according to its docstrings.\n\n\
             Step 1: Read both source files and their docstrings carefully.\n\
             Step 2: Write `test_linkedlist.py` with thorough tests. \
             Use `from linkedlist import DoublyLinkedList` and print \
             \"ALL_TESTS_PASSED\" at the end if all assertions pass.\n\
             Step 3: Run `python3 test_linkedlist.py` to see which tests catch bugs.",
            node_file, dll_file)),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 run_tests.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![node_file.clone(), dll_file.clone(), ap(dir, "test_linkedlist.py")]),
            vec![dll_fixed, runner, dll_buggy])
    }
    v.push(scen!("xhard_testing_04_linked_list", Category::Testing, Difficulty::Hard, I, setup));
}
