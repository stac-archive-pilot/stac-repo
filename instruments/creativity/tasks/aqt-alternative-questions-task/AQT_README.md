# Alternative Questions Task (AQT)

## Overview

This folder contains files related to the **Alternative Questions Task (AQT)**. The AQT is a divergent thinking task designed to measure creative question generation. Instead of asking participants to generate alternative uses (as in the traditional AUT), the AQT requires participants to produce creative and unusual questions about everyday objects within a fixed time window. 

The task is rated for multiple dimensions of creativity, including **fluency** and **originality** as well as **question complexity**. It has been used in recent work examining creative cognition, question-asking, and the structure of semantic memory.
## Files

- **AQT_Task.qsf:** Qualtrics file


## Administration and Scoring

### Administration
Participants are presented with two or three common objects (sock, pencil, pillow, clock, purse, knife), one at a time. For each object, they are given **two minutes** to generate as many creative and original questions about the object as possible.

**Core Instructions:**
> "The goal is to come up with *creative questions*, which are questions that strike people as clever, unusual, interesting, uncommon, humorous, innovative, or different."

**Key Parameters:**
* **Time Limit:** 2 minutes per object.
* **Input:** Participants type questions (up to 30 response fields per object).
* **Constraints:** No examples are provided to avoid anchoring.

### Scoring
Performance is evaluated across three complementary dimensions after removing invalid responses (fragments, non-questions, etc.):

1.  **Fluency:** Calculated as the average number of valid questions generated across the objects. Higher scores indicate greater ideational productivity.
2.  **Originality:** Captures how novel and creative each question is. Scored using **OCSAI**, a fine-tuned large language model trained to approximate human creativity judgments (1 = very unoriginal, 5 = very original)
Scoring is done using the CUSTOM setting in OCSAI and this description of task "In this task participants will generate creative questions about common household objects"
Also mark "use full question instead of prompt for better results.
    * *Model Resource:* https://openscoring.streamlit.app/
3.  **Complexity:** Reflects the cognitive level elicited by each question based on Bloom’s taxonomy (Remember–Create). Scored using **PrediQT**, a transformer language model trained on human-rated AQT questions
Model Resource:* https://huggingface.co/spaces/Tman212/question_complexity_scoring.
    * *Validation:* The PrediQT model shows strong correspondence with human ratings (r ≈ .73).

## Citation

If you use this measure in your published work, please cite the reference(s) below:

Raz, T., Reiter-Palmon, R., & Kenett, Y. N. (2025). The role of asking more complex questions in creative thinking. *Psychology of Aesthetics, Creativity, and the Arts*, 19(6), 1505-1525. https://doi.org/10.1037/aca0000658


## Licensing

All files within this folder are free to use for academic and non-commercial purposes. 
