import tkinter as tk
from tkinter import messagebox

class NotesApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Offline Notes App")
        
        self.note_entry = tk.Entry(root, width=50)
        self.note_entry.pack(pady=10)
        
        add_button = tk.Button(root, text="Add Note", command=self.add_note)
        add_button.pack(pady=5)
        
        view_button = tk.Button(root, text="View Notes", command=self.view_notes)
        view_button.pack(pady=5)

    def add_note(self):
        note_text = self.note_entry.get()
        if note_text:
            with open("notes.txt", "a") as file:
                file.write(note_text + "\n")
            messagebox.showinfo("Note Added", "Note has been added successfully.")
            self.note_entry.delete(0, tk.END)
        else:
            messagebox.showwarning("Empty Note", "Please enter a note before adding.")

    def view_notes(self):
        try:
            with open("notes.txt", "r") as file:
                notes = file.read()
            if notes:
                messagebox.showinfo("Your Notes", notes)
            else:
                messagebox.showinfo("No Notes", "You have no notes yet.")
        except FileNotFoundError:
            messagebox.showinfo("No Notes", "You have no notes yet.")

if __name__ == "__main__":
    root = tk.Tk()
    app = NotesApp(root)
    root.mainloop()
