package parse

import "testing"

func TestContainer(t *testing.T) {
	t.Parallel()

	container, err := Container("0,1,4,3")
	if err != nil {
		t.Fatalf("Container() error = %v", err)
	}

	if container.X != 0 || container.Y != 1 || container.W != 4 || container.H != 3 {
		t.Fatalf("unexpected container: %+v", container)
	}
}

func TestContainerValidation(t *testing.T) {
	t.Parallel()

	cases := []string{"", "1,2,3", "a,b,c,d", "-1,0,1,1", "0,0,13,1", "0,0,2,0"}
	for _, tc := range cases {
		_, err := Container(tc)
		if err == nil {
			t.Fatalf("expected error for %q", tc)
		}
	}
}

func TestJSONObject(t *testing.T) {
	t.Parallel()

	obj, err := JSONObject(`{"k":1}`)
	if err != nil {
		t.Fatalf("JSONObject() error = %v", err)
	}

	if obj["k"].(float64) != 1 {
		t.Fatalf("unexpected object: %+v", obj)
	}
}

func TestJSONObjectRejectsNonObject(t *testing.T) {
	t.Parallel()

	_, err := JSONObject(`[]`)
	if err == nil {
		t.Fatal("expected error for array")
	}
}

func TestOrder(t *testing.T) {
	t.Parallel()

	actual := Order([]string{"inst-1,inst-2", " inst-3 ", ""})
	if len(actual) != 3 {
		t.Fatalf("unexpected order length: %d", len(actual))
	}

	want := []string{"inst-1", "inst-2", "inst-3"}
	for i := range want {
		if actual[i] != want[i] {
			t.Fatalf("order[%d]=%q want=%q", i, actual[i], want[i])
		}
	}
}
