// JavaScript for Quick Note functionality

function saveNote() {
    // Get the value from the textarea
    var note = document.getElementById("quickNote").value;

    if (note.trim() !== "") {
        // Create a new list item
        var li = document.createElement("li");
        li.appendChild(document.createTextNode(note));

        // Append the note to the savedNotes list
        document.getElementById("savedNotes").appendChild(li);

        // Clear the textarea after saving
        document.getElementById("quickNote").value = "";
    } else {
        alert("Please enter a note before saving.");
    }
}
